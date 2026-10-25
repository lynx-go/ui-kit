import type { CollectionHandle } from "@lynx-go/ui-kit/react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "../values/states";

/**
 * ListPage（query 块）—— 列表页配方骨架：header × toolbar × 四态 × appendix。
 * 所有 part 都是 ReactNode（结构性逃生舱）：不满意任一部分就传自己的组件，
 * 只要消费 list 句柄。四态在此切换；DataTable 只渲染 success 表体。
 * header 可选（title/actions 全缺省时不渲染——消费方自有页头架构时
 * shell-agnostic 化，§12.10-⑤；fleetly/torchwood 先例回流）。
 */
export interface ListPageProps<T> {
  title?: string;
  description?: string;
  actions?: ReactNode;
  toolbar?: ReactNode;
  pagination?: ReactNode;
  appendix?: ReactNode;
  list: CollectionHandle<T>;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  children: ReactNode; // success 态内容（通常 <DataTable list={list} …/>）
}

export function ListPage<T>({
  title,
  description,
  actions,
  toolbar,
  pagination,
  appendix,
  list,
  emptyTitle = "Nothing here",
  emptyDescription,
  emptyAction,
  children,
}: ListPageProps<T>) {
  const showHeader = title !== undefined || description !== undefined || actions !== undefined;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-6">
      {showHeader ? (
        <header className="flex items-start justify-between gap-4">
          <div>
            {title ? <h1 className="text-lg font-semibold">{title}</h1> : null}
            {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <Card>
        {toolbar}
        {list.status === "loading" ? (
          <LoadingState />
        ) : list.status === "error" ? (
          <ErrorState error={list.error!} onRetry={list.refetch} />
        ) : list.status === "empty" ? (
          <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
        ) : (
          children
        )}
        {list.status !== "loading" && list.status !== "error" ? pagination : null}
      </Card>
      {appendix}
    </div>
  );
}
