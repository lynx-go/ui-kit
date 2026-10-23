import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * CopyButton（values 块）—— 复制反馈窗口可参数化（旧项目双源魔法值的对策）。
 */
export interface CopyButtonProps {
  value: string;
  /** 复制成功反馈停留时长，默认 1500ms */
  feedbackMs?: number;
  label?: string;
}

export function CopyButton({ value, feedbackMs = 1500, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label ?? "Copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), feedbackMs);
        } catch {
          // clipboard 不可用（非安全上下文）——静默；上层可换选中文案方案
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5 text-muted" />}
    </Button>
  );
}
