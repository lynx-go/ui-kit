import type { SubscriptionEngine } from "@fleetly/fleet-ui-kit/react";
import { PauseCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * EventFeed（subscription 块）—— useSubscription 输出的参照实现（EventFeed↔Subscription）。
 * 倒序（最新在上）+ gapped 黄条（resyncs 信号）+ 暂停指示灯。
 * backlog 行与首个 live 帧的去重按 (cursor, id)——getKey 由页面给（events 的 seq、
 * documents changes 的 revision），本块不认业务键。
 */

export interface EventFeedProps<F> {
  sub: SubscriptionEngine<F>;
  /**
   * backlog Query 的行（静态前缀；与 live 帧按 getKey 去重，锚点交接见 design.md §2.3）。
   * 约定时间正序（旧→新）传入——collection 页通常最新在前，方言语序翻转由页面吸收。
   */
  backlog?: ReadonlyArray<F>;
  /** 帧去重键（cursor/id 复合语义由调用方吸收进单一键） */
  getKey: (frame: F) => string | number;
  /** 行渲染；缺省 String(frame) */
  render?: (frame: F) => ReactNode;
  /** gapped/stalled 黄条上的动作槽（页面的 resync 编排按钮） */
  resyncAction?: ReactNode;
  className?: string;
}

export function EventFeed<F>({
  sub,
  backlog,
  getKey,
  render,
  resyncAction,
  className,
}: EventFeedProps<F>) {
  const frames = useSyncExternalStore(sub.subscribeFrames, sub.getFrames, sub.getFrames);
  const state = useSyncExternalStore(sub.subscribeStatus, sub.getState, sub.getState);

  // 合并 backlog 前缀与 live 帧（同键去重：backlog 定位、live 值覆盖）
  const merged = new Map<string | number, F>();
  for (const row of backlog ?? []) merged.set(getKey(row), row);
  for (const frame of frames) merged.set(getKey(frame), frame);
  const rows = [...merged.values()].reverse(); // 最新在上

  const showGapBar = state.status === "gapped" || state.status === "stalled";
  const rowRender = render ?? ((frame: F) => String(frame));

  return (
    <div className={cn("overflow-hidden rounded-md border border-line", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-panel px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted">Events</span>
          <Badge
            tone={state.status === "live" ? "ok" : state.status === "error" ? "err" : "warn"}
            data-testid="sub-status"
          >
            {state.status}
          </Badge>
          {state.resyncs > 0 && state.status !== "gapped" ? (
            <span
              className="rounded-full bg-warn/15 px-2 py-0.5 text-[11px] text-warn"
              data-testid="resynced-chip"
            >
              re-synced ×{state.resyncs}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {state.status === "paused" ? (
            <span
              className="flex items-center gap-1 text-[11px] text-muted"
              data-testid="paused-indicator"
            >
              <PauseCircle className="size-3.5" />
              Paused — frames buffered from cursor on resume
            </span>
          ) : null}
          <span className="text-[11px] text-muted">{rows.length} events</span>
        </div>
      </div>
      {showGapBar ? (
        <div
          className="flex items-center justify-between gap-2 border-b border-warn/40 bg-warn/10 px-3 py-1.5 text-xs text-warn"
          data-testid="gap-bar"
          role="status"
        >
          <span>
            {state.status === "gapped"
              ? "Retention gap — re-anchor the backlog to continue."
              : "Backoff budget exhausted — reconnect or switch to polling fallback."}
          </span>
          {resyncAction}
        </div>
      ) : null}
      <ul className="max-h-96 divide-y divide-line overflow-y-auto">
        {rows.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-muted">No events yet</li>
        ) : (
          rows.map((frame) => (
            <li
              key={getKey(frame)}
              className="flex items-center gap-3 px-3 py-1.5 text-xs"
              data-key={getKey(frame)}
            >
              {rowRender(frame)}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
