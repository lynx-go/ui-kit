import { useEffect, useState } from "react";

/**
 * RelativeTime（values 块）—— 时区感知的相对时间（torchwood 时区偏好的对应物）。
 * 显示按浏览器/注入时区，title 悬浮给绝对时间。
 */
export interface RelativeTimeProps {
  value: string | number | Date;
  timeZone?: string;
  /** 刷新间隔，默认 30s；0 = 不刷新 */
  refreshMs?: number;
}

function formatRelative(target: number, now: number): string {
  const diff = Math.round((target - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 10) return "just now";
  if (abs < 60) return `${Math.round(diff)}s ago`;
  if (abs < 3600) return `${Math.round(diff / 60)}m ago`;
  if (abs < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function RelativeTime({ value, timeZone, refreshMs = 30_000 }: RelativeTimeProps) {
  const target = new Date(value).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (refreshMs <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);
  const absolute = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(target));
  return (
    <time dateTime={new Date(target).toISOString()} title={absolute}>
      {formatRelative(target, now)}
    </time>
  );
}
