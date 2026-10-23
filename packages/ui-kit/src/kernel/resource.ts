import type {
  CollectionQuery,
  CommandResult,
  Segment,
  SubscriptionPolicy,
  Transport,
} from "./types";

// ============ 交互面：Resource ============

/** branded 资源名——QuerySelector 收 branded 类型，拼错编译期爆炸。 */
declare const resourceBrand: unique symbol;
export type ResourceName = string & { readonly [resourceBrand]?: "ResourceName" };

export type ResourceScope = Readonly<Record<string, string | undefined>>;

export interface CommandDescriptor<Input, Payload, ID = never> {
  run(input: Input, ctx: ResourceScope): Promise<CommandResult<Payload>>;
  /** 跨资源失效声明（纯数据）；默认与命令执行的 ctx scope 相交 */
  invalidates?: ReadonlyArray<QuerySelector>;
  /** 结果覆写钩子：命令作者裁决协议层状态的领域语义（delete 已删 → 幂等 ok 等） */
  treatAs?: Partial<Record<"not-found" | "forbidden", CommandResult<Payload>>>;
}

export interface SubscriptionDescriptor<Params, Frame> {
  open(params: Params, ctx: ResourceScope): Transport<Frame>;
  /** 流属性默认在资源侧声明；调用点可覆盖 */
  policy?: SubscriptionPolicy;
}

export type CommandsRecord<ID> = Record<string, CommandDescriptor<any, any, ID>>;
export type SubsRecord = Record<string, SubscriptionDescriptor<any, any>>;

export interface ResourceSpec<
  T,
  ID = string,
  C extends CommandsRecord<ID> = Record<string, never>,
  S extends SubsRecord = Record<string, never>,
> {
  name: string;
  /** 可选——command-only/流式资源无 id 语义；DataTable/绑定的 getRowId 显式传入 */
  getId?: (row: T) => ID;
  /** scope 键名（如 ["projectId"]），scoped() 约定用 */
  scope?: ReadonlyArray<string>;

  collection?: (
    q: CollectionQuery,
    ctx: ResourceScope,
    signal?: AbortSignal,
  ) => Promise<Segment<T>>;
  record?: (id: ID, ctx: ResourceScope, signal?: AbortSignal) => Promise<T>;
  batch?: (
    ids: ReadonlyArray<ID>,
    ctx: ResourceScope,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<T>>;

  commands?: C;
  subscriptions?: S;
}

export interface Resource<
  T,
  ID = string,
  C extends CommandsRecord<ID> = Record<string, never>,
  S extends SubsRecord = Record<string, never>,
> {
  readonly name: ResourceName;
  readonly getId?: (row: T) => ID;
  readonly scope?: ReadonlyArray<string>;

  readonly collection?: (
    q: CollectionQuery,
    ctx: ResourceScope,
    signal?: AbortSignal,
  ) => Promise<Segment<T>>;
  readonly record?: (id: ID, ctx: ResourceScope, signal?: AbortSignal) => Promise<T>;
  readonly batch?: (
    ids: ReadonlyArray<ID>,
    ctx: ResourceScope,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<T>>;

  readonly commands?: C;
  readonly subscriptions?: S;
  /** scoped() 注入的作用域值（内部约定，勿直接读写） */
  readonly __scopeValues?: ResourceScope;
}

/**
 * 定义一个实体/流族的交互面（三原语各自可选）。
 * 泛型 C/S 逐键保留具体 CommandDescriptor/SubscriptionDescriptor——不被擦成 any。
 */
export function defineResource<
  T,
  ID,
  C extends CommandsRecord<ID> = Record<string, never>,
  S extends SubsRecord = Record<string, never>,
>(spec: ResourceSpec<T, ID, C, S>): Resource<T, ID, C, S> {
  if (!/^[a-z][a-z0-9-]*$/.test(spec.name)) {
    throw new Error(
      `fleet-ui: resource name "${spec.name}" must be kebab-case (it lives in query keys and URL diagnostics)`,
    );
  }
  return { ...spec, name: spec.name as ResourceName };
}

/**
 * scoped 约定（派生，非框架轴）：queryKey 嵌入 scope 段 + 适配器 ctx 注入。
 * 适配器可在 http 实例上把 ctx 注入 header（torchwood X-Torchwood-Project）。
 */
export function scoped<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
  values: ResourceScope,
): Resource<T, ID, C, S> {
  return {
    ...resource,
    __scopeValues: { ...(resource.__scopeValues ?? {}), ...values },
  };
}

export function scopeOf<T, ID, C extends CommandsRecord<ID>, S extends SubsRecord>(
  resource: Resource<T, ID, C, S>,
): ResourceScope {
  return resource.__scopeValues ?? {};
}

// ============ 失效选择器（kernel 纯数据；执行在绑定层） ============

export interface QuerySelector {
  resource: ResourceName;
  /** 缺省 = 该资源全部查询形态 */
  kind?: "collection" | "record" | "batch";
  id?: unknown;
  /** 显式跨作用域失效（罕见；默认与命令 ctx scope 相交） */
  allScopes?: boolean;
}
