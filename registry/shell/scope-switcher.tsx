import { useEffect } from "react";
import { Select } from "@/components/ui/select";

/**
 * ScopeSwitcher（shell 块）——作用域切换器（project/namespace/cluster…实体词
 * 留页面）。含陈旧 id 校正（design §6.1）：value 不在 options（URL 深链到已
 * 删除的作用域/记忆残留）时，effect 期回落首个可用——不在渲染期回调
 * （§2.1.1 同律）；校正经 onChange 的 meta.source="correction" 传给页面，
 * 页面据此选 replace（归一化）而非 push（用户切换）。
 * 双通道（URL↔storage）同步是配方层四件套（写方向/synced 守卫/storage 桥/
 * 防乒乓），demo scopes 页是参照实现——块只管呈现与校正回调。
 */
export interface ScopeOption {
  value: string;
  label: string;
}

export interface ScopeSwitcherProps {
  /** 无障碍名（如 "Project"——实体词归页面） */
  label?: string;
  value: string | undefined;
  options: ReadonlyArray<ScopeOption>;
  onChange: (value: string, meta: { source: "user" | "correction" }) => void;
  /** 陈旧 id 校正发生时的一行说明（缺省不渲染） */
  staleNote?: string;
}

export function ScopeSwitcher({
  label = "Scope",
  value,
  options,
  onChange,
  staleNote,
}: ScopeSwitcherProps) {
  const stale =
    value !== undefined && options.length > 0 && !options.some((o) => o.value === value);

  // 陈旧 id 校正：effect 期回落首个可用（渲染期回调会违反写入契约）
  useEffect(() => {
    if (stale && options.length > 0) {
      onChange(options[0]!.value, { source: "correction" });
    }
  }, [stale, options, onChange]);

  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label={label}
        data-testid="scope-switcher"
        value={stale ? "" : (value ?? "")}
        onChange={(e) => onChange(e.target.value, { source: "user" })}
      >
        {stale ? (
          <option value="">{value} — unavailable</option>
        ) : value === undefined && options.length === 0 ? (
          <option value="">Loading…</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {stale && staleNote ? <span className="text-xs text-muted">{staleNote}</span> : null}
    </div>
  );
}
