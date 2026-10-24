import type { CollectionHandle } from "@fleetly/ui-kit/react";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  type LegacyColumnDef,
  useLegacyTable,
} from "@tanstack/react-table/legacy";
import type { RowData } from "@tanstack/table-core";
import { cn } from "@/lib/utils";

/**
 * DataTable（query 块）—— 消费 useCollection 句柄的表格。
 *
 * 状态归属（design.md §6.1）：排序/过滤/窗口归 URL（CollectionQuery），表内禁用内建
 * sorting/filtering 分支；行选择/展开等瞬态后续经 v9 atoms 接入（command 线）。
 * 列经 meta.sortField 声明可排序，点击头循环 none→asc→desc（走 list.setOrder，URL 为真相）。
 *
 * 注：当前经 @tanstack/react-table/legacy（v8 兼容层，双 console 现行用法）；
 * 迁移 v9 原生 features 是块内改动，块 API 不变。
 */
export interface SortableColumnMeta {
  sortField?: string;
}

export interface DataTableProps<T extends RowData> {
  list: CollectionHandle<T>;
  columns: LegacyColumnDef<T, any>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T extends RowData>({
  list,
  columns,
  getRowId,
  onRowClick,
}: DataTableProps<T>) {
  const table = useLegacyTable({
    data: list.rows as T[],
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
  });

  const currentSort = list.query.order?.[0];
  const toggleSort = (field: string) => {
    const current = currentSort?.field === field ? currentSort : undefined;
    const next =
      current === undefined
        ? [{ field, dir: "asc" as const }]
        : current.dir === "asc"
          ? [{ field, dir: "desc" as const }]
          : [];
    list.setOrder(next.length > 0 ? next : null);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-line text-left text-xs text-muted">
              {headerGroup.headers.map((header) => {
                const sortField = (header.column.columnDef.meta as SortableColumnMeta | undefined)
                  ?.sortField;
                const active = currentSort?.field === sortField && sortField !== undefined;
                return (
                  <th key={header.id} className="px-3 py-2 font-medium">
                    {header.isPlaceholder ? null : sortField ? (
                      <button
                        type="button"
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-fg",
                          active && "text-fg",
                        )}
                        onClick={() => toggleSort(sortField)}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {active ? (
                          <span aria-hidden>{currentSort?.dir === "asc" ? "↑" : "↓"}</span>
                        ) : null}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className={cn(
                "border-b border-line/60 hover:bg-panel-2/50",
                onRowClick && "cursor-pointer",
              )}
              onClick={onRowClick ? () => onRowClick(row.original as T) : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
