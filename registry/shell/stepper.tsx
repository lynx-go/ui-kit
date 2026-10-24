import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Stepper（shell 块）——向导进度骨架（§6.3：向导 = Stepper[ n × Form|等待步骤 ]）。
 *
 * 受控：页面持有 current（步骤推进 = 表单提交/等待完成的事件，不由块自决）；
 * 已完成步骤可点回跳（onStepClick 缺省 = 只读展示）。等待步骤的进行态由当前步
 * 内容渲染（StageTimeline/spinner），指示器只认 完成/当前/待办 三态。
 */

export interface StepDef {
  key: string;
  label: string;
}

export interface StepperProps {
  steps: ReadonlyArray<StepDef>;
  /** 当前步 index（受控） */
  current: number;
  /** 点击已完成步骤回跳；缺省 = 不可点 */
  onStepClick?: (index: number) => void;
  /** 当前步内容（页面按 current 渲染——Form 或等待视图） */
  children: ReactNode;
  className?: string;
}

export function Stepper({ steps, current, onStepClick, children, className }: StepperProps) {
  return (
    <div className={cn("space-y-4", className)} data-testid="stepper">
      <ol className="flex items-center gap-1" aria-label="Progress">
        {steps.map((step, index) => {
          const state = index < current ? "done" : index === current ? "current" : "pending";
          const clickable = onStepClick !== undefined && index < current;
          return (
            <li key={step.key} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <span
                  className={cn("h-px w-6 shrink-0", index <= current ? "bg-accent" : "bg-line")}
                  aria-hidden
                />
              ) : null}
              <button
                type="button"
                disabled={!clickable}
                onClick={clickable ? () => onStepClick?.(index) : undefined}
                data-step-index={index}
                data-step-state={state}
                className={cn(
                  "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm",
                  clickable && "hover:bg-panel-2",
                  !clickable && "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
                    state === "done" && "bg-ok/20 text-ok",
                    state === "current" && "bg-accent/20 text-accent",
                    state === "pending" && "bg-panel-2 text-muted",
                  )}
                >
                  {state === "done" ? <Check className="size-3" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "truncate",
                    state === "current" ? "font-medium text-fg" : "text-muted",
                  )}
                >
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div data-testid="stepper-content">{children}</div>
    </div>
  );
}
