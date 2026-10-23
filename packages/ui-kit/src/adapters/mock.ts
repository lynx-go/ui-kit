import type { ApiError, CollectionQuery, ResourceScope, Segment } from "../kernel";
import { decodeClientCursor, encodeClientCursor, evaluateQuery, isApiError } from "../kernel";

/**
 * mockResource —— Resource/Transport 契约的内存实现。
 * 双职责：测试工具（延迟/失败注入/三态）+ demo 数据源（双方言演示）。
 */

export type MockFetchAll<T> = ((
  ctx: ResourceScope,
  signal?: AbortSignal,
) => Promise<ReadonlyArray<T>>) &
  MockHandle<T>;

export interface MockHandle<T> {
  /** 替换全部行（demo 动态数据 / 测试重置） */
  replaceRows(rows: ReadonlyArray<T>): void;
  /** 下一次 collection/record/batch 调用按给定失败 reject（三态与闭环测试） */
  failNext(error: ApiError): void;
  /** 当前行数 */
  readonly count: number;
}

export type MockDialect = "keyset" | "offset";

export interface MockCollectionOptions {
  dialect?: MockDialect;
  latencyMs?: number;
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function maybeFail<T>(
  handle: { takeFailure(): ApiError | undefined },
  work: () => Promise<T>,
): Promise<T> {
  const failure = handle.takeFailure();
  if (failure) throw failure;
  return work();
}

class MockHandleImpl<T> implements MockHandle<T> {
  failureQueue: ApiError[] = [];
  rows: T[];
  constructor(rows: ReadonlyArray<T>) {
    this.rows = [...rows];
  }
  replaceRows(rows: ReadonlyArray<T>): void {
    this.rows = [...rows];
  }
  failNext(error: ApiError): void {
    this.failureQueue.push(error);
  }
  takeFailure(): ApiError | undefined {
    return this.failureQueue.shift();
  }
  get count(): number {
    return this.rows.length;
  }
}

export interface MockCollection<T> {
  collection: (
    query: CollectionQuery,
    ctx: ResourceScope,
    signal?: AbortSignal,
  ) => Promise<Segment<T>>;
  record: (id: string, ctx: ResourceScope) => Promise<T>;
  batch: (ids: ReadonlyArray<string>, ctx: ResourceScope) => Promise<ReadonlyArray<T>>;
  handle: MockHandle<T>;
}

/**
 * 服务端方言模拟（keyset / offset）。谓词与排序照常求值（模拟服务端过滤），
 * 分页按方言切片：keyset 发不透明 token（空页停发），offset 附带 total。
 */
export function mockCollection<T extends { id: string }>(
  initialRows: ReadonlyArray<T>,
  options: MockCollectionOptions = {},
): MockCollection<T> {
  const handle = new MockHandleImpl(initialRows);
  const { dialect = "offset", latencyMs = 0 } = options;

  const collection = async (query: CollectionQuery): Promise<Segment<T>> => {
    return maybeFail(handle, async () => {
      await delay(latencyMs);
      // 先全量求值谓词/排序（模拟服务端），再按方言切窗口
      const w = query.window;
      let offset: number;
      if (w.cursor !== undefined) {
        const decoded = decodeClientCursor(w.cursor);
        offset = decoded ?? 0;
      } else {
        offset = w.range?.offset ?? 0;
      }
      const serverQuery: CollectionQuery =
        dialect === "keyset" || w.cursor !== undefined
          ? { ...query, window: { size: w.size, cursor: encodeClientCursor(offset) } }
          : { ...query, window: { size: w.size } };
      const segment = evaluateQuery(serverQuery, handle.rows);
      const out: Segment<T> = { rows: segment.rows };
      if (dialect === "offset") out.total = segment.total ?? handle.rows.length;
      else if (segment.rows.length === w.size && offset + w.size < handle.rows.length)
        out.nextCursor = encodeClientCursor(offset + w.size);
      return out;
    });
  };

  const record = async (id: string): Promise<T> => {
    return maybeFail(handle, async () => {
      await delay(latencyMs);
      const row = handle.rows.find((r) => r.id === id);
      if (!row) throw { kind: "not-found" } satisfies ApiError;
      return row;
    });
  };

  const batch = async (ids: ReadonlyArray<string>): Promise<ReadonlyArray<T>> => {
    return maybeFail(handle, async () => {
      await delay(latencyMs);
      const byId = new Map(handle.rows.map((r) => [r.id, r]));
      return ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
    });
  };

  return {
    collection,
    record,
    batch,
    handle: {
      replaceRows: (rows) => handle.replaceRows(rows),
      failNext: (error) => handle.failNext(error),
      get count() {
        return handle.count;
      },
    },
  };
}

/** 整取数据源（clientCollection 的 fetchAll）。 */
export function mockFetchAll<T>(
  initialRows: ReadonlyArray<T>,
  options: { latencyMs?: number } = {},
): MockFetchAll<T> {
  const handle = new MockHandleImpl([...initialRows]);
  const fn = async (): Promise<ReadonlyArray<T>> => {
    const failure = handle.takeFailure();
    if (failure) throw failure;
    await delay(options.latencyMs ?? 0);
    return handle.rows;
  };
  return Object.assign(fn, {
    replaceRows: (rows: ReadonlyArray<T>) => handle.replaceRows(rows),
    failNext: (error: ApiError) => handle.failNext(error),
    get count() {
      return handle.count;
    },
  }) as MockFetchAll<T>;
}

export { isApiError };
