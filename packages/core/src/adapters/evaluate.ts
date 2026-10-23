import type { CollectionQuery, ResourceScope, Segment } from "../kernel";
import { evaluateQuery } from "../kernel";

export { decodeClientCursor, encodeClientCursor, evaluateQuery } from "../kernel";

/**
 * clientCollection —— 客户端求值方言（求值策略，非概念）。
 *
 * 整取 fetchAll 后本地求值谓词/排序/窗口，伪造不透明游标（offset 编进 token），
 * 兑现"游标进 URL、历史即分页栈"。fetchAll 的取数上限由消费方持有
 * （fleetly 现状：projects=100 / apps=200 / deployments=50 参差，适配器常量）。
 */
export function clientCollection<T>(
  fetchAll: (ctx: ResourceScope, signal?: AbortSignal) => Promise<ReadonlyArray<T>>,
): (query: CollectionQuery, ctx: ResourceScope, signal?: AbortSignal) => Promise<Segment<T>> {
  return async (query, ctx, signal) => {
    const rows = await fetchAll(ctx, signal);
    return evaluateQuery(query, rows);
  };
}
