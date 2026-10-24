import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * JsonField（values 块）——结构化值的查看/编辑两态。
 *
 * 查看 = 格式化 pre；编辑 = textarea 草稿 + Apply。校验反馈的关键契约：**坏 JSON 不
 * 回写值**——Apply 只在 parse 成功时 onChange(parsed)，失败停编辑态报错（value 永远
 * 是最后一份合法值）。onChange 缺席 = 纯查看（详情页只读 spec）。
 */

export interface JsonFieldProps {
  value: unknown;
  /** 出席 = 可编辑（查看/编辑两态）；缺席 = 永远查看态 */
  onChange?: (next: unknown) => void;
  label?: string;
  /** 序列化（缺省 2-space JSON.stringify；undefined 序列化为 null） */
  serialize?: (value: unknown) => string;
  className?: string;
}

const defaultSerialize = (value: unknown) => JSON.stringify(value ?? null, null, 2);

export function JsonField({ value, onChange, label, serialize, className }: JsonFieldProps) {
  const stringify = serialize ?? defaultSerialize;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(stringify(value));
    setError(null);
    setEditing(true);
  };

  const apply = () => {
    try {
      const parsed = JSON.parse(draft) as unknown;
      onChange?.(parsed);
      setError(null);
      setEditing(false); // 只有合法 JSON 才离开编辑态——值已回写
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid JSON");
    }
  };

  return (
    <div className={cn("space-y-1.5", className)} data-testid="json-field">
      {label ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted">{label}</span>
        </div>
      ) : null}
      {editing ? (
        <div className="space-y-1.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={Math.min(16, Math.max(4, draft.split("\n").length + 1))}
            spellCheck={false}
            aria-label={label ?? "JSON value"}
            data-testid="json-field-input"
            className="w-full rounded-md border border-line bg-bg p-2 font-mono text-xs outline-none focus:border-accent"
          />
          {error ? (
            <p className="text-xs text-err" data-testid="json-field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={apply} data-testid="json-field-apply">
              <Check className="size-3.5" /> Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              <X className="size-3.5" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-panel p-2 font-mono text-xs">
            {stringify(value)}
          </pre>
          {onChange ? (
            <Button size="sm" variant="outline" onClick={startEdit} data-testid="json-field-edit">
              <Pencil className="size-3.5" /> Edit
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
