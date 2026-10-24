import {
  type CollectionQuery,
  type Operator,
  type Order,
  type Predicate,
  type QueryWindow,
  textPredicate,
} from "../kernel";

/**
 * /schema —— CollectionQuery 的 URL 编解码（Effect Schema 单源的公开面）。
 *
 * 对外只暴露纯函数 + Standard Schema 包装：消费方可自选 schema 库，
 * 与自有 search 参数在纯对象层合并（validateSearch 接受纯函数）。
 * URL 键名定案：q / filter=field:op:value（重复键）/ sort=field:dir / cursor / page / size。
 */

export interface FilterFieldDef {
  field: string;
  /** 缺省 "eq" */
  op?: Operator;
  label?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
}

export interface QuerySchemaSpec {
  /** q 参与文本搜索的字段白名单 */
  text?: ReadonlyArray<string>;
  filters?: ReadonlyArray<FilterFieldDef>;
  /** 默认 20 */
  defaultSize?: number;
  defaultOrder?: ReadonlyArray<Order>;
}

/** URL 中的扁平参数形状（human-readable）。 */
export interface FlatSearchParams {
  q?: string;
  filter?: ReadonlyArray<string>;
  sort?: ReadonlyArray<string>;
  cursor?: string;
  page?: number;
  size?: number;
}

export type FlatPatch = Partial<
  Record<string, string | number | ReadonlyArray<string> | undefined>
>;

/** Standard Schema v1 的最小结构形状（TanStack Router validateSearch 直收）。 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  "~standard": {
    version: 1;
    vendor: "fleet-ui";
    validate(value: Input): { value: Output };
  };
}

const OPERATORS = new Set<string>([
  "eq",
  "ne",
  "contains",
  "in",
  "gt",
  "lt",
  "gte",
  "lte",
  "exists",
]);

export interface QuerySearchSchema {
  toSearchSchema(): StandardSchemaV1<unknown, FlatSearchParams>;
  encode(query: CollectionQuery): FlatSearchParams;
  decode(params: unknown): CollectionQuery;
  patch(part: {
    predicate?: Predicate | null;
    order?: ReadonlyArray<Order> | null;
    window?: QueryWindow;
  }): FlatPatch;
  readonly defaults: CollectionQuery;
  readonly spec: QuerySchemaSpec;
}

export function collectionQuerySchema(spec: QuerySchemaSpec = {}): QuerySearchSchema {
  const defaultSize = spec.defaultSize ?? 20;
  const defaults: CollectionQuery = {
    window: { size: defaultSize },
    ...(spec.defaultOrder ? { order: spec.defaultOrder } : {}),
  };

  // ---- 谓词 <-> 扁平键 ----

  function encodePredicate(predicate: Predicate | undefined): {
    q?: string;
    filter?: ReadonlyArray<string>;
  } {
    if (predicate === undefined) return {};
    const textSet = new Set(spec.text ?? []);
    const filters: string[] = [];
    let q: string | undefined;
    for (const leaf of flattenLeaves(predicate)) {
      if (
        leaf.op === "contains" &&
        textSet.has(leaf.field as string) &&
        typeof leaf.value === "string"
      ) {
        q = q === undefined ? leaf.value : q; // 同值多字段（textPredicate 的 any 形）
        continue;
      }
      const value = Array.isArray(leaf.value) ? leaf.value.join(",") : String(leaf.value);
      filters.push(`${leaf.field}:${leaf.op}:${value}`);
    }
    return { ...(q !== undefined ? { q } : {}), ...(filters.length ? { filter: filters } : {}) };
  }

  function flattenLeaves(p: Predicate): ReadonlyArray<Extract<Predicate, { field: string }>> {
    if ("field" in p) return [p];
    if ("all" in p) return p.all.flatMap(flattenLeaves);
    // any 只允许 textPredicate 产生的纯文本形；一般 OR 树不进 URL（消费方自定义参数）
    const leaves = p.any.flatMap(flattenLeaves);
    const textSet = new Set(spec.text ?? []);
    const isText = leaves.every(
      (l) => l.op === "contains" && textSet.has(l.field as string) && typeof l.value === "string",
    );
    if (!isText) {
      throw new Error(
        "fleet-ui: predicate with OR is not URL-serializable — keep it in local state or a custom search param",
      );
    }
    return leaves;
  }

  function parseFilterEntry(entry: string): Extract<Predicate, { field: string }> | null {
    const i1 = entry.indexOf(":");
    const i2 = entry.indexOf(":", i1 + 1);
    if (i1 < 0 || i2 < 0) return null;
    const field = entry.slice(0, i1);
    const op = entry.slice(i1 + 1, i2);
    if (!OPERATORS.has(op)) return null;
    const rawValue = entry.slice(i2 + 1);
    const value = op === "in" ? rawValue.split(",").filter(Boolean) : rawValue;
    return { field, op: op as Operator, value };
  }

  function decodePredicate(params: FlatSearchParams): Predicate | undefined {
    const parts: Predicate[] = [];
    if (params.q !== undefined) {
      const text = textPredicate(spec.text ?? [], params.q);
      if (text) parts.push(text);
    }
    for (const entry of params.filter ?? []) {
      const leaf = parseFilterEntry(entry);
      if (leaf) parts.push(leaf);
    }
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    return { all: parts };
  }

  // ---- 窗口 <-> 键 ----

  function decodeWindow(params: FlatSearchParams): QueryWindow {
    const size = positiveInt(params.size) ?? defaultSize;
    if (params.cursor !== undefined && params.cursor !== "") {
      return { size, cursor: params.cursor };
    }
    const page = positiveInt(params.page);
    if (page !== undefined && page > 1) {
      return { size, range: { offset: (page - 1) * size } };
    }
    return { size };
  }

  // ---- 归一化（validateSearch 用；容忍脏输入，绝不 throw） ----

  function normalize(input: unknown): FlatSearchParams {
    const raw = (input ?? {}) as Record<string, unknown>;
    const out: FlatSearchParams = {};
    if (typeof raw.q === "string" && raw.q.trim() !== "") out.q = raw.q;
    const filter = toArray(raw.filter).filter((e) => parseFilterEntry(e) !== null);
    if (filter.length > 0) out.filter = filter;
    const sort = toArray(raw.sort).filter((e) => {
      const i = e.indexOf(":");
      if (i < 0) return false;
      return e.slice(i + 1) === "asc" || e.slice(i + 1) === "desc";
    });
    if (sort.length > 0) out.sort = sort;
    if (typeof raw.cursor === "string" && raw.cursor !== "") out.cursor = raw.cursor;
    const page = positiveInt(raw.page);
    if (page !== undefined && page > 1) out.page = page;
    const size = positiveInt(raw.size);
    if (size !== undefined && size !== defaultSize) out.size = size;
    return out;
  }

  function decodeOrders(params: FlatSearchParams): ReadonlyArray<Order> | undefined {
    const orders = (params.sort ?? [])
      .map((e) => {
        const i = e.indexOf(":");
        const field = e.slice(0, i);
        const dir = e.slice(i + 1);
        return dir === "asc" || dir === "desc" ? ({ field, dir } as Order) : null;
      })
      .filter((o): o is Order => o !== null);
    return orders.length > 0 ? orders : undefined;
  }

  return {
    spec,
    defaults,
    toSearchSchema() {
      return {
        "~standard": {
          version: 1,
          vendor: "fleet-ui",
          validate(value: unknown) {
            return { value: normalize(value) };
          },
        },
      };
    },
    encode(query: CollectionQuery): FlatSearchParams {
      const flat: FlatSearchParams = { ...encodePredicate(query.predicate) };
      if (query.order?.length) flat.sort = query.order.map((o) => `${o.field}:${o.dir}`);
      const w = query.window;
      flat.size = w.size;
      if (w.cursor !== undefined) flat.cursor = w.cursor;
      else if (w.range && w.range.offset > 0) flat.page = Math.floor(w.range.offset / w.size) + 1;
      return flat;
    },
    decode(params: unknown): CollectionQuery {
      const flat = normalize(params);
      // "URL + schema 默认值即真相"：URL 无 sort 时落 defaultOrder（不落会静默丢默认排序）
      const order = decodeOrders(flat) ?? spec.defaultOrder;
      return {
        ...(decodePredicate(flat) !== undefined ? { predicate: decodePredicate(flat) } : {}),
        ...(order ? { order } : {}),
        window: decodeWindow(flat),
      };
    },
    patch(part): FlatPatch {
      const out: FlatPatch = {};
      if ("predicate" in part) {
        Object.assign(out, encodePredicate(part.predicate ?? undefined));
        out.cursor = undefined; // 换谓词回第一页
        out.page = undefined;
      }
      if ("order" in part) {
        const order = part.order ?? [];
        if (order.length > 0) out.sort = order.map((o) => `${o.field}:${o.dir}`);
        else out.sort = undefined;
        out.cursor = undefined; // 换向回第一页（keyset 游标与方向耦合）
        out.page = undefined;
      }
      if (part.window) {
        const w = part.window;
        if ("size" in w) out.size = w.size;
        if (w.cursor !== undefined) {
          out.cursor = w.cursor;
          out.page = undefined;
        } else if (w.range) {
          out.page = Math.floor(w.range.offset / w.size) + 1;
          out.cursor = undefined;
        }
      }
      return out;
    },
  };
}

// ---- 工具 ----

function toArray(value: unknown): ReadonlyArray<string> {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value !== "") return [value];
  return [];
}

function positiveInt(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}
