import type { SubscriptionEngine } from "@lynx-go/ui-kit/react";
import { ArrowDown, Download, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * LogViewer（subscription 块）—— useSubscription 输出的参照实现（LogViewer↔Subscription）。
 * 固定高度滚动 + 智能跟随（贴底即跟随，上滚即停）+ jump-to-live + 下载/清空；
 * 容量上限由订阅策略的环形缓冲承担（policy.buffer 丢最旧），本块只呈现。
 * 虚拟滚动后置：帧量级在缓冲上限内时固定高度滚动即够（双 console 实证）。
 */

const STATUS_TONE: Record<string, "ok" | "warn" | "err" | "neutral"> = {
  live: "ok",
  reconnecting: "warn",
  paused: "neutral",
  gapped: "warn",
  stalled: "warn",
  ended: "neutral",
  error: "err",
};

export interface LogViewerProps<F> {
  sub: SubscriptionEngine<F>;
  formatLine: (frame: F, index: number) => string;
  /** 容器高度（px） */
  height?: number;
  /** 行不断行（默认折行）；长日志行建议保持折行 */
  wrap?: boolean;
  fileName?: string;
}

export function LogViewer<F>({
  sub,
  formatLine,
  height = 420,
  wrap = true,
  fileName = "logs.txt",
}: LogViewerProps<F>) {
  const frames = useSyncExternalStore(sub.subscribeFrames, sub.getFrames, sub.getFrames);
  const state = useSyncExternalStore(sub.subscribeStatus, sub.getState, sub.getState);

  const containerRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  // 智能跟随：贴底时新帧到达即贴底（useLayoutEffect 防闪跳）
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (following && el) el.scrollTop = el.scrollHeight;
  }, [frames, following]);

  const jumpToLive = () => setFollowing(true);

  const download = () => {
    const text = frames.map((frame, index) => formatLine(frame, index)).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="overflow-hidden rounded-md border border-line">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-panel px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted">Log stream</span>
          <Badge tone={STATUS_TONE[state.status] ?? "neutral"} data-testid="log-status">
            {state.status}
          </Badge>
          <span className="text-[11px] text-muted">{frames.length} lines</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={download} aria-label="Download logs">
            <Download className="size-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => sub.clear()} aria-label="Clear logs">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="relative">
        <div
          ref={containerRef}
          onScroll={onScroll}
          role="log"
          aria-label="log lines"
          className="overflow-y-auto bg-panel/40 p-3 font-mono text-xs leading-5"
          style={{ height }}
        >
          {frames.length === 0 ? (
            <p className="text-muted">Waiting for frames…</p>
          ) : (
            frames.map((frame, index) => (
              <div
                key={index}
                data-line={index}
                className={cn("whitespace-pre", wrap ? "break-all" : "whitespace-nowrap")}
              >
                {formatLine(frame, index)}
              </div>
            ))
          )}
        </div>
        {!following ? (
          <Button
            variant="outline"
            size="sm"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow"
            onClick={jumpToLive}
            data-testid="jump-to-live"
          >
            <ArrowDown className="size-3.5" />
            Jump to live
          </Button>
        ) : null}
      </div>
    </div>
  );
}
