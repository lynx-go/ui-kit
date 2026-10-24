import { Page } from "@blocks/shell/page";
import { MetricChart, type MetricSeries } from "@blocks/values/metric-chart";
import { RelativeTime } from "@blocks/values/relative-time";
import { StatCard } from "@blocks/values/stat-card";
import { StatusBadge } from "@blocks/values/status-badge";
import { collectionQueryOptions, useCan, useRecord } from "@lynx-go/ui-kit";
import type { ApiError, Segment } from "@lynx-go/ui-kit/kernel";
import { recordKey } from "@lynx-go/ui-kit/kernel";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  CPU_SERIES_KEYS,
  CPU_SERVER_CAP,
  formatBytes,
  formatPercent,
  MEM_SERIES_KEYS,
  type MetricRow,
  metricsResource,
} from "@/lib/metrics";
import type { Widget } from "@/lib/mock-data";
import { identityResource, toggleIdentityRole, widgetsClient } from "@/lib/resources";

export const Route = createFileRoute("/")({
  component: OverviewPage,
});

const WINDOWS = [
  { label: "15m", ms: 15 * 60_000 },
  { label: "30m", ms: 30 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
] as const;

/**
 * 自定义内容页（无 CustomPage 的论证页）：普通文件路由 + Page 外壳 + 任意组合。
 * 仪表盘配方（§6.3）：StatCard × n + MetricChart × n (queries)。单值统计 =
 * useQuery+select 聚合；时序 = collection（时间窗谓词 t >= from，§7.1 推导）。
 */
function OverviewPage() {
  const all = useQuery<Segment<Widget>, ApiError>({
    ...collectionQueryOptions(widgetsClient, { window: { size: 100 } }),
    staleTime: 30_000,
  });
  const widgets = all.data?.rows ?? [];
  const running = widgets.filter((w) => w.status === "running").length;
  const degraded = widgets.filter((w) => w.status === "degraded").length;
  const replicas = widgets.reduce((sum, w) => sum + w.replicas, 0);

  const [windowMs, setWindowMs] = useState<number>(WINDOWS[1].ms);
  const from = useMemo(() => Date.now() - windowMs, [windowMs]);

  const cpu = useMetrics("cpu", from, CPU_SERIES_KEYS);
  const mem = useMetrics("mem", from, MEM_SERIES_KEYS);

  return (
    <Page
      title="Overview"
      description="Dashboard recipe — StatCard × n + MetricChart × n; single values aggregate client-side, series are collections with a time-window predicate."
      actions={
        <div className="flex items-center gap-1" data-testid="chart-window">
          {WINDOWS.map((w) => (
            <Button
              key={w.label}
              size="sm"
              variant={windowMs === w.ms ? "default" : "outline"}
              onClick={() => setWindowMs(w.ms)}
            >
              {w.label}
            </Button>
          ))}
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Widgets"
          value={all.isPending ? "…" : String(widgets.length)}
          hint="fleetly dialect · client-evaluated"
        />
        <StatCard label="Running" value={all.isPending ? "…" : String(running)} tone="ok" />
        <StatCard
          label="Degraded"
          value={all.isPending ? "…" : String(degraded)}
          tone={degraded > 0 ? "warn" : "default"}
        />
        <StatCard
          label="Replicas"
          value={all.isPending ? "…" : String(replicas)}
          hint="sum across widgets"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>CPU — {CPU_SERIES_KEYS.length} series, render cap 10</CardHeader>
          <CardContent className="pt-2">
            <MetricChart
              series={cpu}
              formatValue={formatPercent}
              maxSeries={10}
              serverCap={CPU_SERVER_CAP}
              height={200}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>Memory working set</CardHeader>
          <CardContent className="pt-2">
            <MetricChart series={mem} formatValue={formatBytes} height={200} />
          </CardContent>
        </Card>
      </div>

      <IdentityGateCard />
      <LatestWidgets widgets={widgets} pending={all.isPending} failed={all.isError} />
    </Page>
  );
}

/**
 * 时序查询：collection + 时间窗谓词（t >= from；metric eq 分图）。
 * 行分组到序列是页面投影——series 字段是数据词汇，块只认 MetricSeries。
 */
function useMetrics(
  metric: "cpu" | "mem",
  from: number,
  seriesKeys: ReadonlyArray<string>,
): ReadonlyArray<MetricSeries> {
  const query = useQuery<Segment<MetricRow>, ApiError>({
    ...collectionQueryOptions(metricsResource, {
      predicate: {
        all: [
          { field: "metric", op: "eq", value: metric },
          { field: "t", op: "gte", value: from },
        ],
      },
      order: [{ field: "t", dir: "asc" }],
      window: { size: 2000 },
    }),
    staleTime: 30_000,
  });
  const rows = query.data?.rows ?? [];
  return useMemo(
    () =>
      seriesKeys.map((key) => ({
        key,
        label: key,
        points: rows.filter((row) => row.series === key).map((row) => ({ t: row.t, v: row.value })),
      })),
    [rows, seriesKeys],
  );
}

function LatestWidgets({
  widgets,
  pending,
  failed,
}: {
  widgets: ReadonlyArray<Widget>;
  pending: boolean;
  failed: boolean;
}) {
  return (
    <Card>
      <CardHeader>Latest widgets</CardHeader>
      <CardContent className="space-y-2 pt-2">
        {widgets.slice(0, 5).map((widget) => (
          <div key={widget.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{widget.name}</span>
            <div className="flex items-center gap-3">
              <RelativeTime value={widget.createdAt} />
              <StatusBadge status={widget.status} />
            </div>
          </div>
        ))}
        {pending ? <p className="text-xs text-muted">Loading…</p> : null}
        {failed ? <p className="text-xs text-err">Failed to load widgets.</p> : null}
      </CardContent>
    </Card>
  );
}

/**
 * useCan 配方卡：identity record Query + 纯谓词，fail-closed。
 * "未就绪"（pending，渲染占位）与"拒绝"（denied，渲染理由）是两个渲染态。
 */
function IdentityGateCard() {
  const queryClient = useQueryClient();
  const me = useRecord(identityResource, { id: "me" });
  const canDelete = useCan(me, (identity) => identity.role === "admin");

  const switchRole = async () => {
    toggleIdentityRole();
    await queryClient.invalidateQueries({ queryKey: recordKey(identityResource, "me") });
  };

  return (
    <Card data-testid="identity-gate">
      <CardHeader>Identity &amp; gating — useCan (fail-closed)</CardHeader>
      <CardContent className="space-y-3 pt-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">{me.data?.name ?? "…"}</span>
            <Badge tone={me.data?.role === "admin" ? "accent" : "neutral"}>
              {me.data ? me.data.role : "loading"}
            </Badge>
          </div>
          <Button variant="outline" size="sm" onClick={switchRole}>
            Switch to {me.data?.role === "admin" ? "viewer" : "admin"}
          </Button>
        </div>
        <div className="rounded-md border border-line p-3">
          {canDelete.state === "pending" ? (
            <p className="text-xs text-muted" data-testid="gate-pending">
              Checking permissions…
            </p>
          ) : canDelete.allowed ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">Danger zone unlocked for admin.</p>
              <Button variant="danger" size="sm" data-testid="gate-action">
                Delete all widgets
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted" data-testid="gate-denied">
              Requires admin role — button hidden (denied is a renderable state, not an error).
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
