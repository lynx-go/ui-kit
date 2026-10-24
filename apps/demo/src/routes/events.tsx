import { Page } from "@blocks/shell/page";
import { EventFeed } from "@blocks/subscription/event-feed";
import {
  collectionQueryOptions,
  useCollection,
  useInvalidateOnFrame,
  usePreference,
  useSubscription,
} from "@fleetly/fleet-ui-kit";
import type { ApiError, Cursor, Segment } from "@fleetly/fleet-ui-kit/kernel";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Widget } from "@/lib/mock-data";
import { widgetsClient } from "@/lib/resources";
import {
  anchorOf,
  appendLiveEvent,
  type EventFrame,
  eventsMockTransport,
  eventsResource,
  eventsSearch,
  eventsStream,
} from "@/lib/streams";

export const Route = createFileRoute("/events")({
  validateSearch: eventsSearch.toSearchSchema(),
  component: EventsPage,
});

/**
 * events 组合页配方（design.md §6.3）：
 * backlog Query 定锚 × Subscription 续订 × EventFeed（含 resync 编排）。
 *
 * - 初始锚 = backlog 最新一端，首次成功即冻结（cursor prop 只用一次；
 *   后续重锚走 sub.resync(newAnchor)——resyncs++ 供黄条渲染）；
 * - gapped 编排 = 重跑 backlog（fetchQuery fresh-read）→ 从新锚重订；
 * - live 帧回写 backlog 存储，重锚才是推进后的锚（见 lib/streams）。
 */
function EventsPage() {
  const list = useCollection(eventsResource, { from: Route.fullPath, search: eventsSearch });
  const queryClient = useQueryClient();
  const [autoResync, setAutoResync] = usePreference("events.autoResync", false);

  const [anchor, setAnchor] = useState<Cursor | null>(null);
  useEffect(() => {
    if (anchor === null && list.rows.length > 0) setAnchor(anchorOf(list.rows));
  }, [list.rows, anchor]);

  const sub = useSubscription(eventsStream, {
    cursor: anchor === null ? undefined : anchor,
    getCursor: (frame: EventFrame) => String(frame.seq),
    onFrame: appendLiveEvent,
  });

  // 实时失效配方（design.md §3 派生表）：事件帧到达 → widgets 全部查询失效。
  // 本页挂一个 widgets 聚合查询做观测点——staleTime 60s 保证重取只能来自失效。
  const widgets = useQuery<Segment<Widget>, ApiError>({
    ...collectionQueryOptions(widgetsClient, { window: { size: 1 } }),
    staleTime: 60_000,
  });
  useInvalidateOnFrame(sub, [{ resource: widgetsClient.name }], { throttleMs: 500 });
  const [widgetsFetches, setWidgetsFetches] = useState(0);
  useEffect(() => {
    setWidgetsFetches((n) => n + 1);
  }, [widgets.dataUpdatedAt]);

  const resyncNow = async (): Promise<void> => {
    // fresh-read：绕过 stale 缓存重跑 backlog（design.md §3 多请求编排）
    const segment = await queryClient.fetchQuery<Segment<EventFrame>, Error>(
      collectionQueryOptions(eventsResource, list.query, { staleTime: 0 }),
    );
    sub.resync(anchorOf(segment.rows));
  };

  useEffect(() => {
    if (sub.status === "gapped" && autoResync) void resyncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub.status, autoResync]);

  const paused = sub.status === "paused";

  return (
    <Page
      title="Events — backlog × live follow"
      description="Query anchors, Subscription continues from the cursor; gap → resync re-anchors the backlog (410 E_EVENTS_GONE dialect)."
    >
      <div className="flex flex-wrap items-center gap-2" data-testid="events-controls">
        <Button
          size="sm"
          variant="outline"
          onClick={() => (paused ? sub.resume() : sub.pause())}
          data-testid="pause-toggle"
        >
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => eventsMockTransport.gap()}>
          Simulate 410 gap
        </Button>
        <Button size="sm" variant="outline" onClick={() => eventsMockTransport.interrupt()}>
          Kill connection
        </Button>
        {sub.status === "stalled" ? (
          <Button size="sm" onClick={() => sub.restart()} data-testid="reconnect">
            Reconnect stream
          </Button>
        ) : null}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={autoResync}
            onChange={(event) => setAutoResync(event.target.checked)}
          />
          auto-resync on gap (usePreference)
        </label>
      </div>

      <EventFeed
        sub={sub}
        /* backlog 页是最新在前（desc）——feed 合并约定时间正序，方言吸收在页面（§2.3） */
        backlog={list.rows.slice().reverse()}
        getKey={(frame) => frame.seq}
        render={(frame) => (
          <>
            <Badge
              tone={frame.type === "deleted" ? "err" : frame.type === "created" ? "ok" : "accent"}
            >
              {frame.type}
            </Badge>
            <span className="font-medium">{frame.actor}</span>
            <span className="truncate text-muted">{frame.message}</span>
            <time className="ml-auto shrink-0 text-muted" dateTime={frame.at}>
              #{frame.seq} · {frame.at.slice(11, 19)}
            </time>
          </>
        )}
        resyncAction={
          <Button size="sm" variant="outline" onClick={() => void resyncNow()} data-testid="resync">
            Resync from backlog
          </Button>
        }
      />
      <p className="text-[11px] text-muted">
        Anchor: {anchor ?? "loading backlog…"} · resyncs: {sub.resyncs} · open connections:{" "}
        {eventsMockTransport.opens.length}
      </p>
      <p className="text-[11px] text-muted" data-testid="invalidate-counter">
        invalidateOnFrame: widgets total {widgets.data?.total ?? "…"} · refetched ×{widgetsFetches}{" "}
        (throttle 500ms)
      </p>
    </Page>
  );
}
