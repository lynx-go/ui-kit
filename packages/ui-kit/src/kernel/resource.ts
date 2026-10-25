import type {
  CollectionQuery,
  CommandResult,
  Segment,
  SubscriptionPolicy,
  Transport,
} from "./types";
import { isApiError } from "./types";

// ============ 交互面：Resource ============

/** branded 资源名——QuerySelector 收 branded 类型，拼错编译期爆炸。 */
declare const resourceBrand: unique symbol;
export type ResourceName = string & { readonly [resourceBrand]?: "ResourceName" };

export type ResourceScope = Readonly<Record<string, string | undefined>>;

export interface CommandDescriptor<Input, Payload, ID = never> {
  run(input: Input, ctx: ResourceScope): Promise<CommandResult<Payload>>;
  /** ID 类型线程锚：CommandsRecord 依资源 id 类型定位（optional 永不出现，
   *  运行时无形状——发布 .ts 源码时消费方 noUnusedLocals 会穿透检查 kit，
   *  未使用的类型参数必须锚定）。 */
  readonly __id?: ID;
  /** 跨资源失效声明（纯数据）；默认与命令执行的 ctx scope 相交 */
  invalidates?: ReadonlyArray<QuerySelector>;
  /**
   * 存量键失效桥（迁移期）：ok 后按返回的前缀键失效（TanStack 前缀语义）。
   * 与 invalidates（kit 键声明）互补——存量 react-query 键（如 ["groups",
   * projectId]）无 fleet 键形，selector 匹配结构性不覆盖，声明面在此。
   * defineResource 把 spec.legacyKeys 注入为各命令缺省；descriptor 自带优先。
   */
  legacyKeys?: (scope: ResourceScope) => ReadonlyArray<readonly unknown[]>;
  /** 结果覆写钩子：命令作者裁决协议层状态的领域语义（delete 已删 → 幂等 ok 等） */
  treatAs?: Partial<Record<"not-found" | "forbidden", CommandResult<Payload>>>;
  /**
   * @internal 归属资源名——defineResource 注入；缺省 invalidates 时的默认失效目标
   * （内置动词同资源失效，跨资源声明走 invalidates）。
   */
  __resource?: ResourceName;
}

export interface SubscriptionDescriptor<Params, Frame> {
  open(params: Params, ctx: ResourceScope): Transport<Frame>;
  /** 流属性默认在资源侧声明；调用点可覆盖 */
  policy?: SubscriptionPolicy;
}

export type CommandsRecord<ID> = Record<string, CommandDescriptor<any, any, ID>>;

/** defineResource 注入 __resource/legacyKeys 后的命令映射（逐键保留具体 Input/Payload 类型） */
export type AttachedCommands<C> = {
  [K in keyof C]: C[K] & {
    __resource?: ResourceName;
    /** defineResource 从 spec.legacyKeys 注入（descriptor 自带优先）；类型面恒可选 */
    legacyKeys?: (scope: ResourceScope) => ReadonlyArray<readonly unknown[]>;
  };
};
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
  /**
   * 存量键失效桥（迁移期）：该资源命令 ok 后额外失效的 react-query 前缀键。
   * 闭包收命令 ctx scope——消费方可把 scope 值嵌进键（如 ["groups", scope.projectId]）。
   */
  legacyKeys?: (scope: ResourceScope) => ReadonlyArray<readonly unknown[]>;

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
  readonly legacyKeys?: (scope: ResourceScope) => ReadonlyArray<readonly unknown[]>;

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

  readonly commands?: AttachedCommands<C>;
  readonly subscriptions?: S;
  /** scoped() 注入的作用域值（内部约定，勿直接读写） */
  readonly __scopeValues?: ResourceScope;
}

/**
 * 定义一个实体/流族的交互面（三原语各自可选）。
 * 泛型 C/S 逐键保留具体 CommandDescriptor/SubscriptionDescriptor——不被擦成 any。
 *
 * 重载注：commands 在 spec 上出现时返回类型收窄为必填（消消费方 `commands!`——
 * 演示/demo 的 `commands?.` 习惯保留在无 commands 的形态）。
 */
export function defineResource<
  T,
  ID,
  C extends CommandsRecord<ID> = Record<string, never>,
  S extends SubsRecord = Record<string, never>,
>(
  spec: ResourceSpec<T, ID, C, S> & { commands: C },
): Resource<T, ID, C, S> & { readonly commands: AttachedCommands<C> };
export function defineResource<
  T,
  ID,
  C extends CommandsRecord<ID> = Record<string, never>,
  S extends SubsRecord = Record<string, never>,
>(spec: ResourceSpec<T, ID, C, S>): Resource<T, ID, C, S>;
export function defineResource<
  T,
  ID,
  C extends CommandsRecord<ID> = Record<string, never>,
  S extends SubsRecord = Record<string, never>,
>(spec: ResourceSpec<T, ID, C, S>): Resource<T, ID, C, S> {
  if (!/^[a-z][a-z0-9-]*$/.test(spec.name)) {
    throw new Error(
      `@lynx-go/ui-kit: resource name "${spec.name}" must be kebab-case (it lives in query keys and URL diagnostics)`,
    );
  }
  const commands = spec.commands
    ? (Object.fromEntries(
        Object.entries(spec.commands).map(([verb, descriptor]) => [
          verb,
          {
            ...descriptor,
            __resource: spec.name as ResourceName,
            // 存量键桥缺省注入：资源级声明对全部命令生效，descriptor 自带优先
            legacyKeys: descriptor.legacyKeys ?? spec.legacyKeys,
          },
        ]),
      ) as AttachedCommands<C>)
    : undefined;
  return { ...spec, commands, name: spec.name as ResourceName };
}

/**
 * runCommand —— 命令执行的单源入口（绑定层与命令式编排共用）。
 * treatAs 在此裁决：协议层失败（not-found/forbidden）被命令作者覆写为结果分支；
 * 其余失败（网络/401/5xx）原样出界走错误通道。
 */
export async function runCommand<Input, Payload, ID>(
  descriptor: CommandDescriptor<Input, Payload, ID>,
  input: Input,
  ctx: ResourceScope,
): Promise<CommandResult<Payload>> {
  try {
    return await descriptor.run(input, ctx);
  } catch (error) {
    if (isApiError(error)) {
      const remap = descriptor.treatAs?.[error.kind as "not-found" | "forbidden"];
      if (remap) return remap;
    }
    throw error;
  }
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
