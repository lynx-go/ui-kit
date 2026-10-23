import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  type ApiError,
  advance,
  type CollectionQuery,
  type CommandsRecord,
  type Order,
  type Predicate,
  type QueryWindow,
  type Resource,
  type ResourceScope,
  type Segment,
  type SubsRecord,
  scoped,
} from "../kernel";
import type { FlatPatch, QuerySearchSchema } from "../schema";
import { batchQueryOptions, collectionQueryOptions, recordQueryOptions } from "./options";

/**
 * useCollection —— collection Query ↔ URL ↔ Table 的绑定。
 *
 * 写入契约（design.md §2.1.1）：
 * - 一切 setter 走函数式 search（对象字面量会静默 strip 消费方自定义参数）；
 * - 翻页 = push（历史栈即分页栈）；谓词/排序变化 = replace + 清游标回第一页；
 * - 绑定不在渲染期 navigate。
 */
export interface CollectionHandle<T> {
  rows: ReadonlyArray<T>;
  segment: Segment<T> | undefined;
  /** 当前解码后的完整查询（URL + schema 默认值即真相） */
  query: CollectionQuery;
  status: "loading" | "empty" | "error" | "success";
  error: ApiError | null;
  total: number | undefined;
  isFetching: boolean;
  refetch: () => void;
  /** replace + 回第一页 */
  setPredicate(predicate: Predicate | null): void;
  /** replace + 回第一页（keyset 游标与方向耦合） */
  setOrder(order: ReadonlyArray<Order> | null): void;
  /** push —— 历史即分页栈 */
  setWindow(window: QueryWindow): void;
  /** 游标推进；返回 false = 不可算（keyset prev 走浏览器历史） */
  next(): boolean;
  prev(): boolean;
  reset(): void;
  /** 逃生舱：直接打 URL 补丁（含消费方自定义参数） */
  searchPatch(patch: FlatPatch, options?: { replace?: boolean }): void;
}

const EMPTY_ROWS: ReadonlyArray<never> = [];

export interface UseCollectionOptions {
  /** 当前路由 fullPath（search 读写都锚定它） */
  from: string;
  /** collectionQuerySchema 的返回值（与路由 validateSearch 共用同一实例） */
  search: QuerySearchSchema;
  scope?: ResourceScope;
  query?: {
    staleTime?: number;
    refetchInterval?: number | false;
    enabled?: boolean;
    /** 默认 true：翻页/过滤过渡不闪 loading */
    keepPrevious?: boolean;
  };
}

export function useCollection<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
  options: UseCollectionOptions,
): CollectionHandle<T> {
  // from 是调用方路由的 fullPath（string）；路由注册类型在消费方，库内桥接为泛型注册
  const rawSearch = useSearch({ from: options.from as never, strict: false }) as unknown as Record<
    string,
    unknown
  >;
  const navigate = useNavigate({ from: options.from as never }) as unknown as (opts: {
    to: string;
    search: (prev: Record<string, unknown>) => Record<string, unknown>;
    replace?: boolean;
  }) => Promise<void>;

  const target = options.scope ? scoped(resource, options.scope) : resource;
  const query = options.search.decode(rawSearch);
  const keepPrevious = options.query?.keepPrevious !== false;

  const result = useQuery<Segment<T>, ApiError>({
    ...collectionQueryOptions(target, query, {
      ...(options.query?.staleTime !== undefined ? { staleTime: options.query.staleTime } : {}),
      ...(options.query?.refetchInterval !== undefined
        ? { refetchInterval: options.query.refetchInterval }
        : {}),
      ...(options.query?.enabled !== undefined ? { enabled: options.query.enabled } : {}),
    }),
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
  });

  const searchPatch = (patch: FlatPatch, navOptions?: { replace?: boolean }) => {
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
      replace: navOptions?.replace ?? false,
    });
  };

  const setPredicate = (predicate: Predicate | null) => {
    searchPatch(options.search.patch({ predicate: predicate ?? null }), { replace: true });
  };
  const setOrder = (order: ReadonlyArray<Order> | null) => {
    searchPatch(options.search.patch({ order: order ?? null }), { replace: true });
  };
  const setWindow = (window: QueryWindow) => {
    searchPatch(options.search.patch({ window }), { replace: false });
  };
  const next = (): boolean => {
    const segment = result.data;
    if (!segment) return false;
    const w = advance(query.window, segment, "next");
    if (!w) return false;
    setWindow(w);
    return true;
  };
  const prev = (): boolean => {
    const segment = result.data;
    if (!segment) return false;
    const w = advance(query.window, segment, "prev");
    if (!w) return false;
    setWindow(w);
    return true;
  };
  const reset = () => {
    searchPatch(
      {
        q: undefined,
        filter: undefined,
        sort: undefined,
        cursor: undefined,
        page: undefined,
      },
      { replace: true },
    );
  };

  const rows = result.data?.rows ?? EMPTY_ROWS;
  const status: CollectionHandle<T>["status"] = result.isPending
    ? "loading"
    : result.isError
      ? "error"
      : rows.length === 0
        ? "empty"
        : "success";

  return {
    rows,
    segment: result.data,
    query,
    status,
    error: result.error ?? null,
    total: result.data?.total,
    isFetching: result.isFetching,
    refetch: () => void result.refetch(),
    setPredicate,
    setOrder,
    setWindow,
    next,
    prev,
    reset,
    searchPatch,
  };
}

export interface RecordHandle<T> {
  data: T | undefined;
  status: "loading" | "error" | "success";
  error: ApiError | null;
  refetch: () => void;
}

export function useRecord<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
  options: { id: ID | undefined; scope?: ResourceScope; query?: { staleTime?: number } },
): RecordHandle<T> {
  const target = options.scope ? scoped(resource, options.scope) : resource;
  const result = useQuery<T, ApiError>({
    ...recordQueryOptions(target, options.id, {
      ...(options.query?.staleTime !== undefined ? { staleTime: options.query.staleTime } : {}),
    }),
  });
  return {
    data: result.data,
    status: result.isPending ? "loading" : result.isError ? "error" : "success",
    error: result.error ?? null,
    refetch: () => void result.refetch(),
  };
}

export interface BatchHandle<T, ID> {
  rows: ReadonlyArray<T>;
  byId: ReadonlyMap<ID, T>;
  status: "loading" | "error" | "success";
}

export function useBatch<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
  ids: ReadonlyArray<ID>,
  options: { scope?: ResourceScope; query?: { staleTime?: number } } = {},
): BatchHandle<T, ID> {
  const target = options.scope ? scoped(resource, options.scope) : resource;
  const result = useQuery<ReadonlyArray<T>, ApiError>({
    ...batchQueryOptions(target, ids, {
      ...(options.query?.staleTime !== undefined ? { staleTime: options.query.staleTime } : {}),
    }),
  });
  const rows = result.data ?? EMPTY_ROWS;
  const byId = new Map(
    rows.map((row) => [target.getId ? target.getId(row) : (row as unknown as { id: ID }).id, row]),
  );
  return {
    rows,
    byId,
    status: result.isPending ? "loading" : result.isError ? "error" : "success",
  };
}
