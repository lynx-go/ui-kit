import type { CollectionHandle } from "@fleetly/fleet-ui-kit/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * KeysetPagination（query 块）—— keyset 无 total 方言（torchwood 全站实证）：
 * 显示 x–y 无总数；空尾页仍渲染分页栏（只能靠上一页退出）；
 * Next 依赖 segment.nextCursor（空页停发令牌=到底）；
 * Prev：advance 可算则本地算（客户端伪造游标），不可算（服务端不透明游标）走浏览器历史
 * ——游标进 URL 后历史栈就是分页栈。
 */
export interface KeysetPaginationProps<T> {
  list: CollectionHandle<T>;
}

export function KeysetPagination<T>({ list }: KeysetPaginationProps<T>) {
  const rows = list.rows.length;
  const hasMore = list.segment?.nextCursor !== undefined;

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-muted">
      <div>
        {rows === 0 ? "No rows this page" : `Showing ${rows} rows${hasMore ? "" : " (end)"}`}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (!list.prev()) window.history.back();
          }}
        >
          <ChevronLeft className="size-3.5" /> Prev
        </Button>
        <Button variant="outline" size="sm" disabled={!hasMore} onClick={() => list.next()}>
          Next <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
