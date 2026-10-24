import { Page } from "@blocks/shell/page";
import { LogViewer } from "@blocks/subscription/log-viewer";
import { usePreference, useSubscription } from "@fleetly/fleet-ui-kit";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createLogsSource, type LogFrame } from "@/lib/streams";

export const Route = createFileRoute("/logs")({
  component: LogsPage,
});

/**
 * 日志页配方：裸 Transport 直用（§2.4——logs 这类特殊流可以不造 Resource）。
 * ndjsonTransport over mock fetch；收流判据在帧内容（final: true → ended）。
 */
function LogsPage() {
  const [source] = useState(() => createLogsSource(900));
  useEffect(() => {
    source.start();
    return () => {
      source.finish(); // 卸载即收流（demo 数据源清理）
    };
  }, [source]);

  // 活尾订阅：cursor 显式 null = 立即开流（区别于 undefined = 等定锚）
  const sub = useSubscription(source.transport, { cursor: null });
  const [wrap, setWrap] = usePreference("logs.wrap", true);

  const paused = sub.status === "paused";

  return (
    <Page
      title="Deployment logs — ndjson stream"
      description="Bare transport subscription (no Resource needed for logs); smart follow, jump-to-live, server-side end via frame content."
    >
      <div className="flex flex-wrap items-center gap-2" data-testid="logs-controls">
        <Button
          size="sm"
          variant="outline"
          onClick={() => (paused ? sub.resume() : sub.pause())}
          data-testid="pause-toggle"
        >
          {paused ? "Resume" : "Pause"}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(event) => setWrap(event.target.checked)}
          />
          wrap lines (usePreference · localStorage)
        </label>
        {sub.status === "ended" ? (
          <Button
            size="sm"
            onClick={() => {
              source.start();
              sub.restart();
            }}
            data-testid="restart-stream"
          >
            Restart stream
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => source.finish()}>
            Server finishes stream
          </Button>
        )}
      </div>

      <LogViewer
        sub={sub}
        formatLine={(frame: LogFrame) =>
          `${frame.ts.slice(11, 23)}  ${frame.level.toUpperCase().padEnd(5)} ${frame.msg}`
        }
        wrap={wrap}
        fileName="dpl-9-logs.txt"
      />
      <p className="text-[11px] text-muted">
        Status light in the toolbar; follow stops when you scroll up — new frames keep arriving
        buffered, Jump to live re-attaches the tail.
      </p>
    </Page>
  );
}
