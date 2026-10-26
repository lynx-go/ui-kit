import type { SubscriptionEngine } from "@lynx-go/uikit-core/react";
import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/**
 * StageTimeline（subscription 块，参照实现级）——阶段时间线：帧流 × 先验阶段目录。
 *
 * 页面声明阶段目录（次序与文案），帧经 onStage 投影为阶段事件推进状态；
 * 与目录无关的帧返回 undefined 跳过（一条流喂多个视图的常态）。
 * 耗时由事件时间戳推出（ended − started；进行中随 tick 走）。时间戳缺席时
 * 以到达时刻兜底——重订/回放的口径由页面选择（带 at 的帧可重放）。
 */

export type StageEventStatus = "active" | "done" | "failed";

export interface StageEvent {
  /** 对应目录 key；目录外的 key 追加到尾部（动态阶段） */
  key: string;
  status: StageEventStatus;
  /** 事件时间戳（ISO）；缺省用到达时刻 */
  at?: string;
  /** 附注行（如"3/5 就绪"） */
  note?: string;
}

export interface StageDef {
  key: string;
  label: string;
}

export interface StageTimelineProps<F> {
  sub: SubscriptionEngine<F>;
  /** 先验阶段目录（次序即呈现次序） */
  stages: ReadonlyArray<StageDef>;
  /** 帧投影：undefined = 与时间线无关 */
  onStage: (frame: F) => StageEvent | undefined;
  /** 进行中阶段的耗时刷新间隔 ms（缺省 1000；0 = 静态） */
  tickMs?: number;
  className?: string;
}

interface StageState {
  status: StageEventStatus;
  startedAt: number;
  endedAt: number | null;
  note?: string;
}

function formatElapsed(ms: number): string {
  if (ms < 0) ms = 0;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function StageTimeline<F>({
  sub,
  stages,
  onStage,
  tickMs = 1000,
  className,
}: StageTimelineProps<F>) {
  const frames = useSyncExternalStore(sub.subscribeFrames, sub.getFrames, sub.getFrames);

  // 折叠：目录次序为骨，目录外 key 追加尾
  const fold = useMemo(() => {
    const byKey = new Map<string, StageState>();
    for (const frame of frames) {
      const event = onStage(frame);
      if (!event) continue;
      const at = event.at ? Date.parse(event.at) : Date.now();
      if (!Number.isFinite(at)) continue;
      const prev = byKey.get(event.key);
      if (!prev) {
        byKey.set(event.key, {
          status: event.status,
          startedAt: event.status === "active" ? at : at, // 首见即终态：跨度按 0 起算
          endedAt: event.status === "active" ? null : at,
          note: event.note,
        });
        continue;
      }
      byKey.set(event.key, {
        status: event.status,
        startedAt: prev.startedAt,
        endedAt: event.status === "active" ? null : at,
        note: event.note ?? prev.note,
      });
    }
    return byKey; // onStage 在依赖里：投影标识变化重算折叠是安全语义（纯函数）
  }, [frames, onStage]);

  const rows = useMemo(() => {
    const ordered = [...stages];
    for (const key of fold.keys()) {
      if (!stages.some((s) => s.key === key)) ordered.push({ key, label: key });
    }
    return ordered.map((def) => ({ def, state: fold.get(def.key) }));
  }, [stages, fold]);

  const hasActive = rows.some((r) => r.state?.status === "active");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasActive || tickMs <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [hasActive, tickMs]);

  return (
    <ol className={cn("divide-y divide-line rounded-md border border-line", className)}>
      {rows.map(({ def, state }) => {
        const status = state?.status ?? "pending";
        const elapsed =
          state && state.endedAt !== null
            ? formatElapsed(state.endedAt - state.startedAt)
            : state
              ? formatElapsed(now - state.startedAt)
              : null;
        return (
          <li
            key={def.key}
            className="flex items-center gap-3 px-3 py-2 text-sm"
            data-stage={def.key}
            data-stage-status={status}
          >
            {status === "done" ? (
              <CheckCircle2 className="size-4 shrink-0 text-ok" />
            ) : status === "failed" ? (
              <XCircle className="size-4 shrink-0 text-err" />
            ) : status === "active" ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
            ) : (
              <CircleDashed className="size-4 shrink-0 text-muted" />
            )}
            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  "font-medium",
                  status === "pending" && "text-muted",
                  status === "active" && "text-accent",
                )}
              >
                {def.label}
              </span>
              {state?.note ? <p className="truncate text-xs text-muted">{state.note}</p> : null}
            </div>
            {elapsed ? (
              <span
                className="shrink-0 text-xs tabular-nums text-muted"
                data-stage-elapsed={def.key}
              >
                {elapsed}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
