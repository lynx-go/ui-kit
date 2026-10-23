/**
 * kernel —— 元概念的契约与纯代数（零依赖、零 react import）。
 *
 * 三个交互原语（问/令/听）+ 一个交互面（Resource）。
 * 设计依据：docs/design.md §2。
 */

// ============ 流几何 ============

/** 不透明定位令牌；collection 的 cursor window 与 subscription 共享。 */
export type Cursor = string;

export type FieldValue = string | number | boolean | ReadonlyArray<string>;

export type Operator =
  | "eq"
  | "ne"
  | "contains"
  | "in"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "exists";

/** 构造侧类型化（可收窄为 `keyof T & string`）、解码侧宽容（string）。 */
type FieldKeyBrand = string & { readonly __fieldKey?: unique symbol };
export type FieldKey<F extends string = string> = F | FieldKeyBrand;

export interface QueryWindow {
  /** 必传（torchwood 契约：pageSize 缺省即截断事故） */
  size: number;
  /** keyset 方言：不透明续读令牌 */
  cursor?: Cursor;
  /** offset 方言（配合 Segment.total） */
  range?: { offset: number };
}

export interface Order {
  field: FieldKey;
  dir: "asc" | "desc";
}

export type Predicate =
  | { field: FieldKey; op: Operator; value: FieldValue }
  | { all: ReadonlyArray<Predicate> }
  | { any: ReadonlyArray<Predicate> };

/** 集合查询的结构化意图。分页只是 window 的字段，不是概念。 */
export interface CollectionQuery {
  predicate?: Predicate;
  order?: ReadonlyArray<Order>;
  window: QueryWindow;
}

/** 查询结果段。字段命名刻意与 useInfiniteQuery 的 getNextPageParam 对齐。 */
export interface Segment<T> {
  rows: ReadonlyArray<T>;
  /** offset 方言必有；leaderboards 型 keyset 也附带 */
  total?: number;
  /** 仅还有下页时出现（"返回数 < size"不代表到底） */
  nextCursor?: Cursor;
}

// ============ 失败通道（封闭集） ============
// 失败 = 无法产出领域可用值的传输/会话/协议层状况。
// 网络断层是 typed failure（可捕获、可重试、可渲染），不是 defect——defect 只留程序错误（§5 缝 1）。

export type ApiError =
  | { kind: "network"; cause?: unknown }
  | { kind: "auth" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "server"; status: number; message?: string }
  | { kind: "decode"; detail: string };

const API_ERROR_KINDS = new Set([
  "network",
  "auth",
  "forbidden",
  "not-found",
  "server",
  "decode",
]);

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === "object" &&
    value !== null &&
    API_ERROR_KINDS.has((value as { kind?: unknown }).kind as string)
  );
}

/** 封闭集的配套：绑定为 Query/Mutation 注入的默认重试分类。 */
export function isRetryable(error: ApiError): boolean {
  return error.kind === "network" || error.kind === "server";
}

// ============ 结果通道（已知分支 + ok 载荷兜底） ============

export type CommandResult<P = unknown> =
  | { status: "ok"; payload: P }
  | {
      status: "rejected";
      /** 机器可判别（双 console 后端都有 code/message——契约不能丢判别码） */
      code?: string;
      message: string;
      fieldErrors?: Record<string, string>;
    }
  | { status: "conflict"; message: string };

// ============ 订阅（听） ============

export interface SubscriptionPolicy {
  /** 环形缓冲容量（超限丢最旧） */
  buffer: number;
  pauseable?: boolean;
  retry?: {
    /** 退避序列，例 [1000, 2000, 4000]。退避耗尽 → stalled，轮询兜底是消费方组合 */
    backoffMs: ReadonlyArray<number>;
  };
}

/** 终态分诊归 transport：票据/base64/E_EVENTS_GONE/部署 state 解析全在消费方适配器。 */
export interface FrameSource<F> {
  [Symbol.asyncIterator](): AsyncIterator<F>;
  /** 迭代器 return（正常结束）时引擎读到的终结原因 */
  readonly closeReason: "ended" | "gapped" | "auth" | "transport";
}

export interface Transport<F> {
  open(cursor: Cursor | null, signal: AbortSignal): FrameSource<F>;
  /** 重连前钩子（torchwood realtime 的"先 refresh 再重订"）；自带恢复的 transport 可不实现 */
  beforeReconnect?(): Promise<void>;
}

export type SubscriptionStatus =
  | "live"
  | "reconnecting"
  | "paused"
  | "gapped"
  | "stalled"
  | "ended"
  | "error";
