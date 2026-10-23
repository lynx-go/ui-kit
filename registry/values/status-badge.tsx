import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * StatusBadge（values 块）—— 状态 → 语义色 token 的唯一映射，映射可注入。
 * 实体无关：缺省表只含通用健康词，业务状态经 `map` 注入。
 */
export type StatusTone = "neutral" | "ok" | "warn" | "err" | "accent";

const DEFAULT_MAP: Record<string, StatusTone> = {
  running: "ok",
  active: "ok",
  healthy: "ok",
  succeeded: "ok",
  stopped: "neutral",
  pending: "warn",
  degraded: "warn",
  warning: "warn",
  failed: "err",
  error: "err",
};

export interface StatusBadgeProps {
  status: string;
  map?: Record<string, StatusTone>;
  className?: string;
}

export function StatusBadge({ status, map, className }: StatusBadgeProps) {
  const tone = { ...DEFAULT_MAP, ...map }[status] ?? "neutral";
  return (
    <Badge tone={tone} className={cn("uppercase", className)}>
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
