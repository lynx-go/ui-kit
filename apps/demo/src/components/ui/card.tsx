import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-lg border border-line bg-panel shadow-xs", className)} {...props} />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("px-4 pt-4 pb-2 text-sm font-medium text-muted", className)} {...props} />
  );
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}
