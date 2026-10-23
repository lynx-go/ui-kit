import type {
  CommandsRecord,
  QuerySelector,
  Resource,
  ResourceScope,
  SubsRecord,
} from "./resource";
import { scopeOf } from "./resource";
import type { CollectionQuery } from "./types";

// ============ 查询键（queryKey 单源；失效选择器在此匹配） ============

/** 键形：[kind, resourceName, scope, ...detail]——前缀与 predicate 失效都依赖此结构。 */
export type QueryKind = "collection" | "record" | "batch";

function canonicalScope(scope: ResourceScope): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(scope).sort()) {
    const value = scope[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function normPredicate(p: CollectionQuery["predicate"]): unknown {
  return p ?? null;
}

function normWindow(w: CollectionQuery["window"]): unknown {
  return { size: w.size, cursor: w.cursor ?? null, offset: w.range?.offset ?? null };
}

export function collectionKey<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
  query: CollectionQuery,
): readonly unknown[] {
  return [
    "collection",
    resource.name,
    canonicalScope(scopeOf(resource)),
    normPredicate(query.predicate),
    query.order ?? null,
    normWindow(query.window),
  ];
}

export function recordKey<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
  id: ID,
): readonly unknown[] {
  return ["record", resource.name, canonicalScope(scopeOf(resource)), id];
}

export function batchKey<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
  ids: ReadonlyArray<ID>,
): readonly unknown[] {
  const unique = [...new Set(ids)];
  return ["batch", resource.name, canonicalScope(scopeOf(resource)), unique];
}

// ============ 失效匹配（scope 交运算在此） ============

const FLEET_KINDS = new Set(["collection", "record", "batch"]);

export function isFleetKey(key: readonly unknown[]): boolean {
  return typeof key[0] === "string" && FLEET_KINDS.has(key[0]);
}

/**
 * selector 匹配：默认与命令执行的 ctx scope 相交（project A 的命令不清 project B 的缓存）；
 * allScopes: true 显式逃逸。
 */
export function selectorMatches(
  selector: QuerySelector,
  key: readonly unknown[],
  commandScope: ResourceScope,
): boolean {
  const [kind, name, keyScope] = key;
  if (selector.kind !== undefined && selector.kind !== kind) return false;
  if (selector.resource !== name) return false;
  if (!selector.allScopes) {
    if (JSON.stringify(keyScope) !== JSON.stringify(canonicalScope(commandScope))) return false;
  }
  if (selector.kind === "record" && selector.id !== undefined) {
    if (key[3] !== selector.id) return false;
  }
  return true;
}

/** 绑定层把 invalidates 声明编译成 TanStack Query 的 predicate 过滤器。 */
export function invalidationPredicate(
  selectors: ReadonlyArray<QuerySelector>,
  commandScope: ResourceScope,
): (query: { queryKey: readonly unknown[] }) => boolean {
  return (query) =>
    isFleetKey(query.queryKey) &&
    selectors.some((s) => selectorMatches(s, query.queryKey, commandScope));
}
