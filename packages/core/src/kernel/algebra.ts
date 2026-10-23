import type { CollectionQuery, FieldValue, Order, Predicate, QueryWindow, Segment } from "./types";

// ============ 谓词求值（纯函数） ============

function fieldOf(row: unknown, field: string): unknown {
  return (row as Record<string, unknown>)[field];
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

function contains(value: unknown, needle: FieldValue): boolean {
  return String(value ?? "")
    .toLowerCase()
    .includes(String(needle).toLowerCase());
}

export function evalPredicate(predicate: Predicate | undefined, row: unknown): boolean {
  if (predicate === undefined) return true;
  if ("all" in predicate) return predicate.all.every((p) => evalPredicate(p, row));
  if ("any" in predicate) return predicate.any.some((p) => evalPredicate(p, row));
  const value = fieldOf(row, predicate.field as string);
  switch (predicate.op) {
    case "eq":
      return value === predicate.value;
    case "ne":
      return value !== predicate.value;
    case "contains":
      return contains(value, predicate.value);
    case "in":
      return Array.isArray(predicate.value) && predicate.value.includes(value as string);
    case "gt":
      return compare(value, predicate.value) > 0;
    case "lt":
      return compare(value, predicate.value) < 0;
    case "gte":
      return compare(value, predicate.value) >= 0;
    case "lte":
      return compare(value, predicate.value) <= 0;
    case "exists":
      return value !== undefined && value !== null;
  }
}

/** 文本搜索谓词：q 在白名单字段上的 contains 之 OR（FilterBar/schema 工厂共用）。 */
export function textPredicate(fields: ReadonlyArray<string>, q: string): Predicate | undefined {
  if (!q.trim() || fields.length === 0) return undefined;
  return {
    any: fields.map((field) => ({ field, op: "contains" as const, value: q.trim() })),
  };
}

// ============ 客户端伪造游标（客户端求值方言） ============
// "游标进 URL、历史即分页栈"在整取方言上的兑现：offset 编进不透明 token。

export function encodeClientCursor(offset: number): string {
  return `c${offset.toString(36)}`;
}

export function decodeClientCursor(cursor: string): number | null {
  if (!cursor.startsWith("c")) return null;
  const n = Number.parseInt(cursor.slice(1), 36);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function offsetOf(window: QueryWindow): number {
  if (window.cursor !== undefined) return decodeClientCursor(window.cursor) ?? 0;
  return window.range?.offset ?? 0;
}

// ============ 客户端求值（派生概念的纯函数核心） ============

/**
 * evaluate(CollectionQuery, rows) —— 求值策略，非概念。
 * window.cursor 存在时保持游标模式（伪造 token）；否则暴露 total（range/客户端翻页用）。
 */
export function evaluateQuery<T>(query: CollectionQuery, rows: ReadonlyArray<T>): Segment<T> {
  const filtered = query.predicate
    ? rows.filter((row) => evalPredicate(query.predicate, row))
    : [...rows];
  const ordered = query.order?.length
    ? [...filtered].sort((a, b) => {
        for (const o of query.order ?? []) {
          const c = compare(fieldOf(a, o.field as string), fieldOf(b, o.field as string));
          if (c !== 0) return o.dir === "desc" ? -c : c;
        }
        return 0;
      })
    : filtered;

  const w = query.window;
  const offset = offsetOf(w);
  const slice = ordered.slice(offset, offset + w.size);
  const segment: Segment<T> = { rows: slice };

  if (w.cursor !== undefined) {
    if (offset + w.size < ordered.length) {
      segment.nextCursor = encodeClientCursor(offset + w.size);
    }
  } else {
    segment.total = ordered.length;
  }
  return segment;
}

// ============ 游标代数 ============

/**
 * 游标推进。返回 null = 不可算：
 * - keyset（服务端不透明游标 / leaderboards 型 token+total）的 prev 走浏览器历史；
 * - 唯一能本地算 prev 的是 offset 方言与客户端求值方言（伪造游标含 offset）。
 */
export function advance(
  window: QueryWindow,
  segment: Segment<unknown>,
  dir: "next" | "prev",
): QueryWindow | null {
  if (dir === "next") {
    if (window.cursor !== undefined) {
      return segment.nextCursor ? { ...window, cursor: segment.nextCursor } : null;
    }
    const offset = offsetOf(window);
    const next = offset + window.size;
    if (segment.total !== undefined && next >= segment.total) return null;
    return { ...window, range: { offset: next } };
  }
  const offset = offsetOf(window);
  if (offset < window.size) return null;
  const prev = { ...window };
  if (window.cursor !== undefined) prev.cursor = encodeClientCursor(offset - window.size);
  else prev.range = { offset: offset - window.size };
  return prev;
}

export function orderEquals(a?: ReadonlyArray<Order>, b?: ReadonlyArray<Order>): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((o, i) => {
    const other = b[i];
    return !!other && o.field === other.field && o.dir === other.dir;
  });
}
