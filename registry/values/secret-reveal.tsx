import { CopyButton } from "./copy-button";

/**
 * SecretReveal（values 块）—— 一次性揭示态：ok 载荷的生命周期语义（只在这一帧存在）。
 * 双 console ×8 处"提交成功 → reveal 卡 + 复制 + 不可再现警告"的对应物。
 */
export interface SecretRevealProps {
  value: string;
  caption?: string;
}

export function SecretReveal({ value, caption }: SecretRevealProps) {
  return (
    <div role="status" className="space-y-2 rounded-md border border-warn/40 bg-warn/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <code className="font-mono text-xs break-all text-warn">{value}</code>
        <CopyButton value={value} />
      </div>
      <p className="text-[11px] text-warn/90">
        {caption ?? "Copy it now — it will not be shown again."}
      </p>
    </div>
  );
}
