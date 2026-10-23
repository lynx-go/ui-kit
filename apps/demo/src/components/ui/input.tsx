import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-line bg-panel px-2.5 text-sm text-fg placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  );
}
