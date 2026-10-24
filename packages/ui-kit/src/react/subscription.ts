import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createSubscriptionEngine, type SubscriptionEngine } from "../adapters/subscription";
import type {
  Cursor,
  ResourceScope,
  SubscriptionDescriptor,
  SubscriptionPolicy,
  Transport,
} from "../kernel";

/**
 * useSubscription —— Subscription 原语的绑定（问/令/听的"听"）。
 *
 * /adapters 引擎句柄 + useSyncExternalStore 接线（design.md §5.3 渲染契约）：
 * - 本 hook 只订阅**状态存储**（status/error/resyncs）——帧到达不触发页面级重渲染；
 *   帧消费块（LogViewer/EventFeed）自行经 sub.subscribeFrames/getFrames 订阅帧存储；
 * - StrictMode 双挂载幂等：引擎在 effect 内创建/销毁，退避状态与 transport 实例
 *   每代独立；
 * - 锚点语义：cursor 传 undefined = 待命不开（backlog→follow 等定锚）；
 *   显式 null = 活尾立即开（日志流）。cursor 值变化 = 重建订阅（清缓冲）；
 *   gapped 后的原地重锚用 sub.resync(newAnchor)（resyncs++ 供黄条），不要换 prop。
 *
 * descriptor | transport 双形态（§2.4）：descriptor（Resource.subscriptions 条目）须声明
 * policy——流属性默认在资源侧声明，兼作运行时判别；裸 Transport 直用（全局流/日志流）。
 */

export interface UseSubscriptionOptions<Params, F> {
  /** descriptor 形态的参数（params 变化 = 重建订阅） */
  params?: Params;
  scope?: ResourceScope;
  /** 覆盖 descriptor.policy（policy 锚定在创建时；中途变更请重建订阅） */
  policy?: SubscriptionPolicy;
  /** 初始锚点；undefined = 待命（backlog 等定锚）；null = 活尾 */
  cursor?: Cursor | null;
  /** 帧游标投影（重连/续订恢复点）；日志流无游标语义可不传 */
  getCursor?: (frame: F) => Cursor | undefined;
  onFrame?: (frame: F) => void;
  /** 缺省：cursor 已定（含显式 null）即开；false = 完全手动（命令式消费） */
  autoStart?: boolean;
}

const IDLE_STATE = { status: "reconnecting", error: null, resyncs: 0 } as const;
const NO_FRAMES: ReadonlyArray<never> = [];
const noop = () => undefined;

function idleEngine<F>(): SubscriptionEngine<F> {
  return {
    frames: NO_FRAMES,
    status: "reconnecting",
    error: null,
    resyncs: 0,
    start: noop,
    stop: noop,
    pause: noop,
    resume: noop,
    restart: noop,
    resync: noop,
    clear: noop,
    onFrame: () => noop,
    subscribeStatus: () => noop,
    getState: () => IDLE_STATE,
    subscribeFrames: () => noop,
    getFrames: () => NO_FRAMES as ReadonlyArray<F>,
  };
}

export function useSubscription<Params, F>(
  source: Transport<F> | SubscriptionDescriptor<Params, F>,
  options: UseSubscriptionOptions<Params, F> = {},
): SubscriptionEngine<F> {
  // 运行时判别：descriptor 声明 policy（资源侧流属性约定，§2.3）；裸 Transport 无 policy
  const descriptor = source as SubscriptionDescriptor<Params, F>;
  const isDescriptor =
    typeof (source as { policy?: unknown }).policy === "object" &&
    typeof source.open === "function";
  const paramsKey = options.params === undefined ? "" : JSON.stringify(options.params);
  const scopeKey = JSON.stringify(options.scope ?? {});
  const policy = options.policy ?? descriptor.policy;
  const policyKey = JSON.stringify(policy ?? null);
  const anchorKey = options.cursor === undefined ? "\u0000waiting" : `\u0000${options.cursor}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: descriptor.open/options.* 由 paramsKey/scopeKey 记忆——params 对象标识每渲染变化不应重开流
  const transport = useMemo<Transport<F>>(() => {
    if (!isDescriptor) return source as Transport<F>;
    return descriptor.open(options.params as Params, options.scope ?? {});
  }, [source, isDescriptor, paramsKey, scopeKey]);

  const [engine, setEngine] = useState<SubscriptionEngine<F> | null>(null);

  // onFrame/getCursor 经 ref 透传（回调标识每渲染变化不应重建订阅；getCursor 是纯投影）
  const onFrameRef = useRef(options.onFrame);
  onFrameRef.current = options.onFrame;
  const getCursorRef = useRef(options.getCursor);
  getCursorRef.current = options.getCursor;

  // biome-ignore lint/correctness/useExhaustiveDependencies: cursor/policy/autoStart 经 anchorKey/policyKey 锚定——引擎重建键 = transport × 锚点 × 策略（创建时值）
  useEffect(() => {
    const created = createSubscriptionEngine<F>({
      transport,
      cursor: options.cursor ?? null,
      getCursor: (frame) => getCursorRef.current?.(frame),
      ...(policy ? { policy } : {}),
      onFrame: (frame) => onFrameRef.current?.(frame),
      // cursor 未定 = 待命；已定（含显式 null 活尾）即开
      autoStart: options.autoStart ?? options.cursor !== undefined,
    });
    setEngine(created);
    return () => {
      created.stop();
    };
  }, [transport, anchorKey, policyKey]);

  const idle = useMemo(() => idleEngine<F>(), []);

  // 页面级只订状态；帧订阅在块内（渲染契约）
  useSyncExternalStore(
    engine ? engine.subscribeStatus : idle.subscribeStatus,
    engine ? engine.getState : idle.getState,
    idle.getState,
  );

  return engine ?? idle;
}
