import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** 原生 select 的样式包装（交互型 Base UI Select 经 shadcn CLI 在 command 线批次引入）。 */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 rounded-md border border-line bg-panel px-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  );
}
