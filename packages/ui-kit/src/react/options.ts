import type { CommandsRecord, SubsRecord } from "../kernel";
import {
  batchKey,
  type CollectionQuery,
  collectionKey,
  type Resource,
  type ResourceScope,
  recordKey,
  type Segment,
  scopeOf,
} from "../kernel";

/**
 * /react —— 绑定（把契约接到 TanStack 引擎与 URL）。
 * 目录级禁 import effect（layer-check 强制）；公开签名零 effect 泄漏。
 */

export interface QueryEngineOptions {
  staleTime?: number;
  refetchInterval?: number | false;
  enabled?: boolean;
}

/** queryOptions 工厂：queryKey 单源；hooks 与 route loader（ensureQueryData/Link preload）共用。 */
export function collectionQueryOptions<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
  query: CollectionQuery,
  options: QueryEngineOptions = {},
): {
  queryKey: readonly unknown[];
  queryFn: (ctx: { signal: AbortSignal }) => Promise<Segment<T>>;
  staleTime?: number;
  refetchInterval?: number | false;
  enabled?: boolean;
} {
  const collection = resource.collection;
  if (!collection) {
    throw new Error(
      `fleet-ui: resource "${String(resource.name)}" has no collection query — did you mean to wrap it with clientCollection()?`,
    );
  }
  return {
    queryKey: collectionKey(resource, query),
    queryFn: ({ signal }) => collection(query, scopeOf(resource), signal),
    ...options,
  };
}

export function recordQueryOptions<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
  id: ID | undefined,
  options: QueryEngineOptions = {},
): {
  queryKey: readonly unknown[];
  queryFn: (ctx: { signal: AbortSignal }) => Promise<T>;
  staleTime?: number;
  refetchInterval?: number | false;
  enabled?: boolean;
} {
  const record = resource.record;
  if (!record) {
    throw new Error(`fleet-ui: resource "${String(resource.name)}" has no record query`);
  }
  if (id === undefined)
    return {
      ...options,
      queryKey: ["record", resource.name, "none"],
      queryFn: () => Promise.reject(new Error("unreachable")),
      enabled: false,
    };
  const scope = scopeOf(resource);
  return {
    queryKey: recordKey(resource, id),
    queryFn: ({ signal }) => record(id, scope, signal),
    ...options,
  };
}

export function batchQueryOptions<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
  ids: ReadonlyArray<ID>,
  options: QueryEngineOptions = {},
): {
  queryKey: readonly unknown[];
  queryFn: (ctx: { signal: AbortSignal }) => Promise<ReadonlyArray<T>>;
  staleTime?: number;
  refetchInterval?: number | false;
  enabled?: boolean;
} {
  const batch = resource.batch;
  if (!batch) {
    throw new Error(`fleet-ui: resource "${String(resource.name)}" has no batch query`);
  }
  const scope = scopeOf(resource);
  return {
    queryKey: batchKey(resource, ids),
    queryFn: ({ signal }) => batch(ids, scope, signal),
    ...options,
  };
}

export type { ResourceScope };
