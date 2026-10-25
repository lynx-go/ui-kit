import { createContext, useContext, type ReactNode } from "react";
import type { ResourceScope } from "../kernel";

/**
 * ResourceScopeProvider —— scope 线程的 Context 单源（scoped() 约定的绑定侧）。
 *
 * 绑定（useCollection/useRecord/useBatch/useCommand/useCommandForm/useSubscription）
 * 在调用点省略 scope 时从这里取值；显式传入的 scope 优先（逃生舱）。
 * 消费方典型形态：应用根把"当前项目"等作用域单源挂进 Provider，页面绑定
 * 不再逐处传 scope 字面量。
 *
 * 未就绪语义：资源声明了 scope 键（spec.scope）而生效 scope 中该键为
 * undefined 时，查询绑定自动停用（enabled: false）——取代消费方逐页的
 * enabled 守卫；"未就绪"查询不启用，也就不会产出"无 scope 键"下的空段
 * 缓存（canonicalScope 丢 undefined 的同键污染面随之关闭）。
 */
const ResourceScopeContext = createContext<ResourceScope | undefined>(undefined);

export function ResourceScopeProvider({
  value,
  children,
}: {
  value: ResourceScope;
  children: ReactNode;
}) {
  return <ResourceScopeContext value={value}>{children}</ResourceScopeContext>;
}

/** @internal 绑定层共用的 context 读取（省略 scope 时的缺省源）。 */
export function useContextScope(): ResourceScope | undefined {
  return useContext(ResourceScopeContext);
}

/**
 * 资源声明的 scope 键是否全部就绪（未声明 = 恒就绪）。
 * 查询绑定用它做自动停用；显式 query.enabled 无法越过未就绪（fail-safe）。
 */
export function scopeReady(
  resource: { scope?: ReadonlyArray<string> },
  scope: ResourceScope | undefined,
): boolean {
  return (resource.scope ?? []).every((key) => scope?.[key] !== undefined);
}
