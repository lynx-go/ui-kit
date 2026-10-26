import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { SubscriptionEngine } from "../adapters/subscription";
import { invalidationPredicate, type QuerySelector, type ResourceScope } from "../kernel";

/**
 * useInvalidateOnFrame —— 实时失效（design.md §3 派生表：帧到达 → invalidate(选择器)）。
 *
 * 组合钩子（非新原语）：订阅帧流 × Query 缓存失效。Selector 语义与 useCommand 的
 * invalidates 完全同源（invalidationPredicate 单源）；scope 缺省与本组件域相交。
 *
 * - filter：帧级谓词（如只对 deleted 帧失效）——过滤是纯函数，热路径零成本；
 * - throttleMs：失效合并窗口（trailing 单射）。热日志流（>10 帧/s）建议给窗口，
 *   invalidateQueries 本身幂等且 active 查询去重，缺省 0 = 每帧即射（语义最小惊讶）。
 */

export interface FrameInvalidator {
  /** 帧已通过调用方过滤后入队（窗口内合并） */
  ingest(): void;
  /** 卸载/重建时丢弃未射的窗口（不给已卸载组件补射失效） */
  cancel(): void;
}

/** 纯调度器（可单测；hook 只做 sub.onFrame × queryClient 接线）。 */
export function createFrameInvalidator(fire: () => void, throttleMs = 0): FrameInvalidator {
  if (throttleMs <= 0) return { ingest: fire, cancel: () => undefined };
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    ingest() {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        fire();
      }, throttleMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

export interface UseInvalidateOnFrameOptions<F> {
  scope?: ResourceScope;
  /** 帧级谓词：只对满足的帧失效（缺省全部帧） */
  filter?: (frame: F) => boolean;
  /** 失效合并窗口 ms（缺省 0 = 每帧即射） */
  throttleMs?: number;
}

export function useInvalidateOnFrame<F>(
  sub: SubscriptionEngine<F>,
  selectors: ReadonlyArray<QuerySelector>,
  options: UseInvalidateOnFrameOptions<F> = {},
): void {
  const queryClient = useQueryClient();
  // 回调/谓词经 ref 透传（标识每渲染变化不应重订帧回调）
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const selectorsKey = JSON.stringify(selectors);

  // biome-ignore lint/correctness/useExhaustiveDependencies: selectors 数组字面量每渲染变化不应重订——经 selectorsKey 锚定
  useEffect(() => {
    const invalidator = createFrameInvalidator(() => {
      void queryClient.invalidateQueries({
        predicate: invalidationPredicate(selectors, optionsRef.current.scope ?? {}),
      });
    }, optionsRef.current.throttleMs ?? 0);
    const unsubscribe = sub.onFrame((frame) => {
      const filter = optionsRef.current.filter;
      if (filter && !filter(frame)) return;
      invalidator.ingest();
    });
    return () => {
      unsubscribe();
      invalidator.cancel();
    };
  }, [sub, queryClient, selectorsKey]);
}
