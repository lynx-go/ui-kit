import { cn } from "@/lib/utils";

/**
 * DiffView（values 块）——字段级旧/新对齐表（fleetly variables diff 实证：服务端产出
 * { path, old_value, new_value } 条目，客户端只做行渲染 + 红绿语义，两 console 均无
 * diff 库）。单值变化做行内 token 化高亮：公共前后缀中性、变化芯着色——前后缀裁剪
 * 纯函数（splitChanged，无 LCS，零依赖，导出可单测）。
 *
 * 实体无关：path 文案与"什么算一个字段"由页面/服务端决定；块只认条目形状。
 */

export interface DiffEntry {
  /** 字段路径（页面/服务端词汇，如 "spec.replicas"） */
  path: string;
  /** 旧值；缺席 = 新增 */
  old?: string;
  /** 新值；缺席 = 删除 */
  new?: string;
}

export interface ChangedSpans {
  /** 公共前缀（两值相同，中性渲染） */
  prefix: string;
  /** 旧值变化芯（划除） */
  oldCore: string;
  /** 新值变化芯（着色） */
  newCore: string;
  /** 公共后缀（中性） */
  suffix: string;
}

/** 前后缀裁剪的行内差异（非 LCS——单值改动的主场景够用且零依赖）。 */
export function splitChanged(oldValue: string, newValue: string): ChangedSpans {
  let start = 0;
  while (
    start < oldValue.length &&
    start < newValue.length &&
    oldValue[start] === newValue[start]
  ) {
    start += 1;
  }
  let end = 0;
  while (
    end < oldValue.length - start &&
    end < newValue.length - start &&
    oldValue[oldValue.length - 1 - end] === newValue[newValue.length - 1 - end]
  ) {
    end += 1;
  }
  return {
    prefix: oldValue.slice(0, start),
    oldCore: oldValue.slice(start, oldValue.length - end),
    newCore: newValue.slice(start, newValue.length - end),
    suffix: newValue.slice(newValue.length - end),
  };
}

export interface DiffViewProps {
  entries: ReadonlyArray<DiffEntry>;
  /** 空集时的说明行（缺省 "No differences"） */
  emptyLabel?: string;
  className?: string;
}

export function DiffView({ entries, emptyLabel = "No differences", className }: DiffViewProps) {
  if (entries.length === 0) {
    return (
      <p className={cn("px-1 py-6 text-center text-xs text-muted", className)}>{emptyLabel}</p>
    );
  }
  return (
    <div
      className={cn("overflow-hidden rounded-md border border-line", className)}
      data-testid="diff-view"
    >
      <div className="grid grid-cols-[minmax(6rem,1fr)_1fr_1fr] gap-x-3 border-b border-line bg-panel px-3 py-1.5 text-[11px] font-medium text-muted">
        <span>Field</span>
        <span>From</span>
        <span>To</span>
      </div>
      <ul className="divide-y divide-line">
        {entries.map((entry) => {
          const added = entry.old === undefined;
          const removed = entry.new === undefined;
          const changed = !added && !removed && entry.old !== entry.new;
          const spans = changed ? splitChanged(entry.old ?? "", entry.new ?? "") : null;
          return (
            <li
              key={entry.path}
              className="grid grid-cols-[minmax(6rem,1fr)_1fr_1fr] items-center gap-x-3 px-3 py-1.5 text-xs"
              data-diff-path={entry.path}
            >
              <span className="truncate font-mono text-xs" title={entry.path}>
                {entry.path}
              </span>
              <span
                className={cn(
                  "block max-w-72 truncate font-mono text-xs",
                  entry.old === undefined && "text-muted",
                  removed && "text-err line-through",
                )}
                title={entry.old}
              >
                {entry.old ?? "—"}
              </span>
              <span
                className={cn(
                  "block max-w-72 truncate font-mono text-xs",
                  entry.new === undefined && "text-muted",
                  added && "text-ok",
                )}
                title={entry.new}
              >
                {entry.new ?? "—"}
              </span>
              {spans ? (
                <span className="col-span-3 flex flex-wrap items-center gap-1 font-mono text-[11px]">
                  <span className="text-muted">{spans.prefix}</span>
                  <span className="rounded-sm bg-err/20 px-0.5 text-err line-through">
                    {spans.oldCore}
                  </span>
                  <span className="rounded-sm bg-ok/20 px-0.5 text-ok">{spans.newCore}</span>
                  <span className="text-muted">{spans.suffix}</span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
