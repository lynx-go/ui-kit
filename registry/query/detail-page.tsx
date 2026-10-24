import type { RecordHandle } from "@fleetly/fleet-ui-kit/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ErrorState, LoadingState } from "../values/states";

/**
 * DetailPage（query 块）——详情页配方骨架：hero × URL tabs × 内容槽（design.md §6.3）。
 *
 * - 消费 useRecord 输出：loading = 骨架、error = 整页错误态（重试接线）；
 * - tabs 是**受控**的——URL 即真相：activeTab 页面从 search 读、onTabChange 页面
 *   navigate（tab 是页面形态非分页 → replace，写入契约 §2.1.1 归页面）；
 * - hero 各槽是函数（拿得到 record data）；SectionCard/字段网格由页面组合进 content。
 */

export interface DetailTab {
  key: string;
  label: string;
  content: ReactNode;
}

export interface DetailPageProps<T> {
  record: RecordHandle<T>;
  /** hero 标题（如记录名） */
  title: (data: T) => ReactNode;
  /** 眉行（面包屑/返回链接——页面给） */
  eyebrow?: ReactNode;
  /** 标题下的 meta 行（StatusBadge/RelativeTime 等 values 块） */
  meta?: (data: T) => ReactNode;
  /** 操作槽（命令块：delete/clone…） */
  actions?: (data: T) => ReactNode;
  tabs: ReadonlyArray<DetailTab>;
  /** 当前 tab（URL 即真相——受控） */
  activeTab: string;
  /** 切 tab = 页面 navigate replace（§2.1.1：非分页不改历史栈） */
  onTabChange: (key: string) => void;
  className?: string;
}

export function DetailPage<T>({
  record,
  title,
  eyebrow,
  meta,
  actions,
  tabs,
  activeTab,
  onTabChange,
  className,
}: DetailPageProps<T>) {
  if (record.status === "loading") {
    return (
      <div className={cn("mx-auto w-full max-w-5xl space-y-4 p-6", className)}>
        <LoadingState rows={3} />
      </div>
    );
  }
  if (record.status === "error") {
    return (
      <div className={cn("mx-auto w-full max-w-5xl p-6", className)}>
        <ErrorState error={record.error!} onRetry={record.refetch} />
      </div>
    );
  }

  const data = record.data as T;
  const active = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];

  return (
    <div className={cn("mx-auto w-full max-w-5xl space-y-4 p-6", className)}>
      <header className="space-y-1.5" data-testid="detail-hero">
        {eyebrow ? <div className="text-xs text-muted">{eyebrow}</div> : null}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{title(data)}</h1>
            {meta ? (
              <div className="mt-1 flex flex-wrap items-center gap-3">{meta(data)}</div>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions(data)}</div> : null}
        </div>
      </header>
      <nav
        className="flex items-center gap-1 border-b border-line"
        data-testid="detail-tabs"
        aria-label="Sections"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            aria-current={tab.key === active?.key ? "page" : undefined}
            data-testid={`detail-tab-${tab.key}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors",
              tab.key === active?.key
                ? "border-accent font-medium text-fg"
                : "border-transparent text-muted hover:text-fg",
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div data-testid="detail-tabpanel">{active?.content}</div>
    </div>
  );
}
