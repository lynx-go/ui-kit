import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  type ApiError,
  type CommandDescriptor,
  type CommandResult,
  invalidationPredicate,
  type QuerySelector,
  type ResourceScope,
  runCommand,
} from "../kernel";
import { useContextScope } from "./scope";

/**
 * useCommand —— Command 原语的绑定（问/令/听的"令"）。
 *
 * - rejected/conflict 是**结果**（mutation.data），只有失败（网络/401/解码）走 mutation.error；
 * - ok 后执行失效：descriptor.invalidates 声明优先，缺省 = 同资源全部查询（内置动词默认失效）；
 *   selector 默认与命令 ctx scope 相交（project A 的命令不清 project B 的缓存）；
 *   legacyKeys 桥在此并行执行（存量 react-query 前缀键，迁移期声明面）；
 * - treatAs 裁决在 kernel runCommand 单源完成；
 * - scope 省略时取 ResourceScopeProvider 的 context 值；
 * - 库不内置 toast：onSettled 回调交消费方（sonner 等）。
 */
export interface UseCommandOptions<Payload> {
  scope?: ResourceScope;
  onSettled?: (result: CommandResult<Payload> | null, failure: ApiError | null) => void;
}

export interface CommandHandle<Input, Payload> {
  mutate(input: Input): void;
  mutateAsync(input: Input): Promise<CommandResult<Payload>>;
  /** 最近一次结果（结果通道，非异常） */
  result: CommandResult<Payload> | null;
  pending: boolean;
  /** 失败通道（ApiError）——与结果两分 */
  failure: ApiError | null;
  reset(): void;
}

/** ok 后的失效编排（kit selector 匹配 + legacyKeys 前缀桥）；导出供测试与命令式编排复用。 */
export function invalidateAfterCommand(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  descriptor: CommandDescriptor<any, any, any>,
  scope: ResourceScope,
): void {
  const selectors: ReadonlyArray<QuerySelector> =
    descriptor.invalidates ??
    (descriptor.__resource !== undefined ? [{ resource: descriptor.__resource }] : []);
  if (selectors.length > 0) {
    void queryClient.invalidateQueries({
      predicate: invalidationPredicate(selectors, scope),
    });
  }
  for (const key of descriptor.legacyKeys?.(scope) ?? []) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

export function useCommand<Input, Payload, ID = never>(
  descriptor: CommandDescriptor<Input, Payload, ID>,
  options: UseCommandOptions<Payload> = {},
): CommandHandle<Input, Payload> {
  const queryClient = useQueryClient();
  // scope 缺省链同查询绑定：显式传入 > （descriptor 声明了 scope 键时——
  // defineResource 注入 __scopeKeys）Provider context > 空。裸 descriptor
  // 无声明锚，不采纳 context。
  const contextScope = useContextScope();
  const scope =
    options.scope ??
    (descriptor.__scopeKeys?.length ? contextScope : undefined) ??
    {};

  const mutation = useMutation<CommandResult<Payload>, ApiError, Input>({
    mutationFn: (input) => runCommand(descriptor, input, scope),
    onSuccess: (result) => {
      if (result.status === "ok") {
        invalidateAfterCommand(queryClient, descriptor, scope);
      }
      options.onSettled?.(result, null);
    },
    onError: (error) => options.onSettled?.(null, error),
  });

  return {
    mutate: (input) => mutation.mutate(input),
    mutateAsync: mutation.mutateAsync,
    result: mutation.data ?? null,
    pending: mutation.isPending,
    failure: mutation.error ?? null,
    reset: mutation.reset,
  };
}

/**
 * useCommandForm —— Command × TanStack Form 的表单绑定（design.md §5.4）。
 *
 * - rejected → onSubmit 返回 { form: message, fields: fieldErrors }（v1 文档化路径；
 *   setErrorMap 已被 v2 alpha 删除——不建在被删的 API 上）；
 * - conflict → form 级消息；ok → 失效已在 useCommand 完成，reveal 载荷经绑定状态暴露
 *   （不进 Query 缓存、卸载即弃）；
 * - 服务端驱动 defaultValues 重播（dirty 不覆盖）由消费方经 key 重挂或 form.reset 实现（后续块内建）。
 */
export interface UseCommandFormOptions<Input extends object, Payload> {
  defaultValues: Input;
  scope?: ResourceScope;
  onSettled?: (result: CommandResult<Payload> | null, failure: ApiError | null) => void;
}

export function useCommandForm<Input extends object, Payload, ID = never>(
  descriptor: CommandDescriptor<Input, Payload, ID>,
  options: UseCommandFormOptions<Input, Payload>,
) {
  const command = useCommand(descriptor, {
    scope: options.scope,
    onSettled: options.onSettled,
  });

  const form = useForm({
    defaultValues: options.defaultValues,
    onSubmit: async ({ value }) => {
      const result = await command.mutateAsync(value);
      if (result.status === "rejected") {
        return {
          form: result.message,
          ...(result.fieldErrors ? { fields: result.fieldErrors } : {}),
        };
      }
      if (result.status === "conflict") {
        return { form: result.message };
      }
      return undefined;
    },
  });

  return {
    form,
    submitting: command.pending || form.state.isSubmitting,
    result: command.result,
    /** 一次性 reveal 载荷（ok payload）：token/邀请等"只在这一帧存在"的值 */
    reveal: command.result?.status === "ok" ? command.result.payload : undefined,
    command,
  };
}
