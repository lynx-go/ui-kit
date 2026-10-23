import { Page } from "@blocks/shell/page";
import { RelativeTime } from "@blocks/values/relative-time";
import { StatusBadge } from "@blocks/values/status-badge";
import { collectionQueryOptions } from "@fleetly/fleet-ui-core";
import type { ApiError, Segment } from "@fleetly/fleet-ui-core/kernel";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Widget } from "@/lib/mock-data";
import { widgetsClient } from "@/lib/resources";

export const Route = createFileRoute("/")({
  component: OverviewPage,
});

/**
 * 自定义内容页（无 CustomPage 的论证页）：普通文件路由 + Page 外壳 + 任意组合。
 * 仪表盘配方：StatCard × n + MetricChart × n (queries)——单值统计是 useQuery+select 聚合，
 * 时序是 collection（时间窗谓词）；不需要第四种查询形。
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

  return (
    <Page
      title="Overview"
      description="Custom content page — plain route + Page shell + composition"
    >
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Widgets" value={all.isPending ? "…" : String(widgets.length)} />
        <Stat label="Running" value={all.isPending ? "…" : String(running)} tone="ok" />
        <Stat label="Degraded" value={all.isPending ? "…" : String(degraded)} tone="warn" />
        <Stat label="Total replicas" value={all.isPending ? "…" : String(replicas)} />
      </div>
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
          {all.isError ? <p className="text-xs text-err">Failed to load widgets.</p> : null}
        </CardContent>
      </Card>
    </Page>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <CardHeader>{label}</CardHeader>
      <CardContent>
        <div
          className={
            tone === "ok"
              ? "text-2xl font-semibold text-ok"
              : tone === "warn"
                ? "text-2xl font-semibold text-warn"
                : "text-2xl font-semibold"
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
