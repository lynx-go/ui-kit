import type { FieldKey, Operator, Predicate } from "../kernel";

/**
 * 谓词 ↔ 过滤值的纯函数层（FilterBar 块与消费方过滤 UI 共用的投影）。
 *
 * 背景：CollectionQuery 的谓词是 AND/OR 树，但过滤 UI 的真身几乎总是
 * "field → 单值"（下拉/输入框）。本层把两者间的样板（叶子抽取、归一化
 * 拼装）收敛为纯函数——FilterBar 变薄壳，消费方不再逐页手写 filtersOf
 * 与三元归一化。
 */

export interface FilterLeaf {
  field: string;
  op: Operator;
  value: string | number | boolean | ReadonlyArray<string>;
}

/**
 * 过滤叶子抽取：展开 AND 树（与 decode 产物同形）返回全部叶子。
 * OR 分支（textPredicate 的 any 形）同样展开为叶子——值读取语义下
 * OR 树仅由文本搜索产生；一般 OR 树不进 URL（codec 裁决），此函数
 * 只作投影不做序列化，保持宽容。
 */
export function filterLeaves(predicate: Predicate | null | undefined): ReadonlyArray<FilterLeaf> {
  if (predicate === null || predicate === undefined) return [];
  if ("field" in predicate) return [predicate];
  if ("all" in predicate) return predicate.all.flatMap(filterLeaves);
  return predicate.any.flatMap(filterLeaves);
}

/**
 * field → 单值投影（过滤 UI 的读路径）：每字段取叶子值，多叶子时后者
 * 覆盖（与单选下拉语义一致）。数组值字段（in 算子）不出现在单值投影中
 * ——需要时用 filterLeaves 直读。
 */
export function filterValues(
  predicate: Predicate | null | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const leaf of filterLeaves(predicate)) {
    if (typeof leaf.value !== "object") out[leaf.field as string] = leaf.value;
  }
  return out;
}

/**
 * 叶子清单 → 规范谓词（过滤 UI 的写路径）：0 → null（清除）、
 * 1 → 裸叶、n → AND。与 setPredicate 配合使用，取代手写三元归一化。
 */
export function predicateOf(parts: ReadonlyArray<Predicate>): Predicate | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] as Predicate;
  return { all: [...parts] };
}

/** 便捷构造：等值过滤叶（过滤 UI 的最常见形态）。 */
export function eqFilter(field: FieldKey, value: string | number | boolean): Predicate {
  return { field, op: "eq", value };
}
