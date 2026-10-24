/**
 * useCan —— 权限门控（design.md §3 派生表：identity record Query + 纯谓词）。
 *
 * - fail-closed：identity 未加载（loading→pending）或加载失败（error→denied）都不放行；
 * - "未就绪"（pending）与"拒绝"（denied）是两个可渲染态——pending 渲染占位而非敏感内容；
 * - 页级门控走 beforeLoad（identity 经 loader 预取 + redirect），元素级用本绑定；
 * - 纯推导拆出 permissionState：beforeLoad 侧没有 hook，loader 预取后调同一函数。
 */

export type PermissionState = "pending" | "granted" | "denied";

/** identity 侧的最小结构面（useRecord 的 RecordHandle 天然满足）。 */
export interface IdentityLike<T> {
  data: T | undefined;
  status: "loading" | "error" | "success";
}

export function permissionState<T>(
  identity: IdentityLike<T>,
  predicate: (identity: T) => boolean,
): PermissionState {
  if (identity.status === "loading") return "pending";
  if (identity.status !== "success" || identity.data === undefined) return "denied";
  return predicate(identity.data) ? "granted" : "denied";
}

export interface CanHandle {
  state: PermissionState;
  /** fail-closed：仅 granted 为 true（pending 不是"暂时允许"） */
  allowed: boolean;
}

export function useCan<T>(
  identity: IdentityLike<T>,
  predicate: (identity: T) => boolean,
): CanHandle {
  const state = permissionState(identity, predicate);
  return { state, allowed: state === "granted" };
}
