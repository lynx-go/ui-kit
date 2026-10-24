import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * StatCard（values 块）——仪表盘统计卡：label + value + 附注（双 console 实证形态：
 * 纯文字三段，无趋势箭头/sparkline——那是分析页图表的职责，不进统计卡）。
 * 值的语义色（如 alerts firing → err）由页面给 tone；pending 态传 "…" 值即可。
 */

export interface StatCardProps {
  label: string;
  /** 统计值（pending 传 "…"；格式化由页面完成——千分位/单位都是页面词汇） */
  value: ReactNode;
  tone?: "default" | "ok" | "warn" | "err";
  /** 附注行（如 "3 public · in demo"） */
  hint?: ReactNode;
  className?: string;
}

const TONE_CLASS: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-fg",
  ok: "text-ok",
  warn: "text-warn",
  err: "text-err",
};

export function StatCard({ label, value, tone = "default", hint, className }: StatCardProps) {
  return (
    <Card className={className} data-testid="stat-card">
      <CardHeader>{label}</CardHeader>
      <CardContent className="space-y-0.5">
        <div className={cn("text-2xl font-semibold tabular-nums", TONE_CLASS[tone])}>{value}</div>
        {hint ? <div className="text-xs text-muted">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
