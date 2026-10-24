import { Effect, Queue, Stream } from "effect";
import type {
  ApiError,
  Cursor,
  FrameSource,
  SubscriptionPolicy,
  SubscriptionStatus,
  Transport,
} from "../kernel";
import { isApiError, isRetryable } from "../kernel";

/**
 * 缝 3 —— 订阅引擎（design.md §5.3；零 React，Promise 站边界）。
 *
 * 管线：Stream.fromAsyncIterable(transport.open(cursor, signal))
 *   → tap（游标推进 / 退避归零 / onFrame）
 *   → Queue.offer(Queue.sliding(policy.buffer))  ←—— 环形缓冲（超限丢最旧）
 *   → 泵纤维 Stream.fromQueue → 快照镜像 + 通知（useSyncExternalStore 的外部存储）
 *
 * 与 §5.3 原案的两处实现期裁决（已回写 design.md）：
 * 1. 退避不用 Stream.retry/Schedule——schedule 状态无法在"连接恢复递送帧"时归零
 *    （fleetly 语义：每次断线从 backoffMs[0] 重新计数），用显式索引驱动；
 * 2. 连接侧不用 Stream.runIntoQueue——它会在流完成时以 Cause.Done 终结队列，
 *    重连需要复用同一环形缓冲，改用 runForEach + Queue.offer。
 *
 * 终态分诊（§2.3）：closeReason 归 transport——引擎只消费 reason。
 *   - 迭代器正常结束 → 按 closeReason 分诊：ended/gapped 停机待命，auth/transport → error；
 *   - 迭代器抛错 → isApiError 且不可重试 → error（401 闭环在订阅侧的落点）；
 *     可重试（network/server）或未知错误 → 传输中断 → 退避重连，耗尽 → stalled；
 *   - 引擎主动 abort（pause/stop/restart/resync）→ AbortError 与传输错误严格区分
 *     （代数递增接管：任何句柄操作先 bump generation，旧驱动环静默退出）。
 *
 * 状态映射（SubscriptionStatus 闭合集的实现期裁决）：
 *   - "reconnecting" 覆盖一切连接建立中（含首连与退避等待）；"live" = open 成功
 *     （安静但健康的流不失真）；未启动/已 stop 的句柄读 status 得 "reconnecting"/"ended"。
 */

export interface SubscriptionState {
  readonly status: SubscriptionStatus;
  readonly error: ApiError | null;
  readonly resyncs: number;
}

/** kernel §2.3 的命令式句柄（引擎实现；useSubscription 直接透传）。 */
export interface SubscriptionHandle<F> {
  readonly frames: ReadonlyArray<F>;
  readonly status: SubscriptionStatus;
  readonly error: ApiError | null;
  readonly resyncs: number;
  pause(): void;
  resume(): void;
  /** 手动重连（fleetly "Reconnect stream" / torchwood 手动重连）；重置退避预算 */
  restart(): void;
  /** gapped 后重锚：清缓冲 + 从新锚点重开（缺省锚点 = 活尾 null）；resyncs++ 供黄条渲染 */
  resync(anchor?: Cursor | null): void;
  clear(): void;
}

export interface SubscriptionEngine<F> extends SubscriptionHandle<F> {
  start(): void;
  /** 终结：断开连接 + 关队列 + 泵退出；status → ended（引擎侧收流，干净终态） */
  stop(): void;
  /** 帧回调（quickstart 命令式消费 / invalidateOnFrame 组合的落点）；返回退订函数 */
  onFrame(callback: (frame: F) => void): () => void;
  /** uSES 状态存储接线（帧到达不触发状态订阅者重渲染） */
  subscribeStatus(listener: () => void): () => void;
  getState(): SubscriptionState;
  /** uSES 帧存储接线（LogViewer/EventFeed 等帧消费块专用） */
  subscribeFrames(listener: () => void): () => void;
  getFrames(): ReadonlyArray<F>;
}

export interface SubscriptionEngineOptions<F> {
  transport: Transport<F>;
  /** 初始锚点（backlog→follow 交接点；null/缺省 = 活尾） */
  cursor?: Cursor | null;
  /** 帧游标投影——重连/续订的恢复点；日志流无游标语义可不传 */
  getCursor?: (frame: F) => Cursor | undefined;
  policy?: SubscriptionPolicy;
  onFrame?: (frame: F) => void;
  /** 默认 true：创建即开（useSubscription 挂载即订）；命令式消费可关 */
  autoStart?: boolean;
}

function sleep(ms: number): Promise<void> {
  return Effect.runPromise(Effect.sleep(ms));
}

export function createSubscriptionEngine<F>(
  options: SubscriptionEngineOptions<F>,
): SubscriptionEngine<F> {
  const transport = options.transport;
  const backoffMs: ReadonlyArray<number> = options.policy?.retry?.backoffMs ?? [];
  const capacity = Math.max(1, Math.floor(options.policy?.buffer ?? 200));

  // —— 外部存储（uSES）：快照缓存，变更即重建引用 ——
  let state: SubscriptionState = { status: "reconnecting", error: null, resyncs: 0 };
  let frames: F[] = [];
  let framesCache: ReadonlyArray<F> | null = null;
  const stateListeners = new Set<() => void>();
  const frameListeners = new Set<() => void>();
  const frameCallbacks = new Set<(frame: F) => void>();

  // —— 驱动状态（退避状态与 transport 实例分离：每代驱动独立，StrictMode 双挂载幂等） ——
  let generation = 0;
  let running = false;
  let attempt = 0; // 已消耗的退避档位；帧递送归零
  let cursor: Cursor | null = options.cursor ?? null;
  let conn: AbortController | null = null;
  let queue: Queue.Queue<F> | null = null;

  function patchStatus(status: SubscriptionStatus, error: ApiError | null): void {
    if (state.status === status && state.error === error) return;
    state = { status, error, resyncs: state.resyncs };
    for (const listener of stateListeners) listener();
  }

  function appendFrame(frame: F): void {
    frames.push(frame);
    if (frames.length > capacity) frames.splice(0, frames.length - capacity);
    framesCache = null; // 读时重建快照（引用稳定到下一次变更）
    for (const listener of frameListeners) listener();
  }

  function onDeliver(frame: F): void {
    const next = options.getCursor?.(frame);
    if (next !== undefined) cursor = next;
    attempt = 0; // 帧恢复 → 退避从 backoffMs[0] 重新计数
    options.onFrame?.(frame);
    for (const callback of frameCallbacks) callback(frame);
  }

  /** 终态分诊：迭代器正常结束，closeReason 归 transport——四种 reason 皆为驱动停机。 */
  function triageClose(reason: FrameSource<F>["closeReason"]): void {
    if (reason === "ended") {
      patchStatus("ended", null);
      return;
    }
    if (reason === "gapped") {
      patchStatus("gapped", null); // 页面监听 gapped → resync()（绑定不自动重跑 backlog）
      return;
    }
    if (reason === "auth") {
      patchStatus("error", { kind: "auth" }); // 401 闭环：订阅通道 auth 失败走全局 handler
      return;
    }
    patchStatus("error", { kind: "network" });
  }

  /** 失败分诊：返回 true = 已定终态（驱动停机）；false = 传输中断（退避重连）。 */
  function triageFailure(error: unknown): boolean {
    if (isApiError(error)) {
      if (isRetryable(error)) return false;
      patchStatus("error", error);
      return true;
    }
    return false; // 未知错误（含传输层 TypeError）按传输中断处理
  }

  async function ensureQueue(gen: number): Promise<Queue.Queue<F> | null> {
    if (queue !== null) return queue;
    const q = await Effect.runPromise(Queue.sliding<F>(capacity));
    if (gen !== generation) {
      void Effect.runPromise(Queue.shutdown(q)); // boot 途中被接管（StrictMode 快速卸载）
      return null;
    }
    queue = q;
    // 泵纤维：环形缓冲 → 快照镜像 + 帧通知；队列 shutdown 即自然退出
    void Effect.runPromise(
      Stream.runForEach(Stream.fromQueue(q), (frame) => Effect.sync(() => appendFrame(frame))),
    ).catch(() => undefined);
    return q;
  }

  async function drive(gen: number): Promise<void> {
    const q = await ensureQueue(gen);
    if (q === null || gen !== generation) return;

    while (gen === generation) {
      const controller = new AbortController();
      conn = controller;
      const connGen = gen; // tap/offer 的代数哨兵：接管后的在途帧不再入缓冲
      patchStatus("reconnecting", null);

      let source: FrameSource<F> | null = null;
      let completed = false;
      let failure: unknown;
      try {
        source = transport.open(cursor, controller.signal);
        // live = 连接建立（open 成功）。安静但健康的流（documents changes 类静流）
        // 不该因"暂无新帧"显示 reconnecting；open 同步抛错走失败分诊。
        patchStatus("live", null);
        await Effect.runPromise(
          Stream.runForEach(
            Stream.tap(
              Stream.fromAsyncIterable(source, (error: unknown) => error),
              (frame) =>
                Effect.sync(() => {
                  if (connGen === generation) onDeliver(frame);
                }),
            ),
            (frame) => (connGen === generation ? Queue.offer(q, frame) : Effect.succeed(false)),
          ),
        );
        completed = true;
      } catch (error) {
        failure = error;
      }

      if (gen !== generation) return; // 已被 pause/stop/restart/resync 接管

      if (conn === controller) conn = null;
      if (completed) {
        triageClose(source?.closeReason ?? "transport"); // 四种 closeReason 皆为终态
        running = false;
        return;
      }
      if (triageFailure(failure)) {
        running = false;
        return;
      }

      // 传输中断 → 退避重连；预算耗尽 → stalled（轮询兜底是消费方组合，§2.3）
      if (attempt >= backoffMs.length) {
        patchStatus("stalled", null);
        running = false;
        return;
      }
      const delay = backoffMs[attempt]!;
      attempt += 1;
      patchStatus("reconnecting", null);
      await sleep(delay);
      if (gen !== generation) return;
      if (transport.beforeReconnect) {
        try {
          await transport.beforeReconnect(); // torchwood realtime"先 refresh 再重订"落点
        } catch {
          // refresh 失败不阻断重订——服务端仍 401 则在下一轮以 auth error 出界
        }
      }
      if (gen !== generation) return;
    }
  }

  function takeover(): number {
    generation += 1;
    conn?.abort(); // 引擎主动 abort：AbortError 与传输错误由此区分（代数接管）
    conn = null;
    return generation;
  }

  function start(): void {
    if (running) return;
    running = true;
    attempt = 0;
    void drive(takeover());
  }

  if (options.autoStart !== false) start();

  return {
    get frames() {
      if (framesCache === null) framesCache = [...frames];
      return framesCache;
    },
    get status() {
      return state.status;
    },
    get error() {
      return state.error;
    },
    get resyncs() {
      return state.resyncs;
    },

    start,
    stop() {
      running = false;
      takeover();
      const q = queue;
      queue = null;
      if (q) void Effect.runPromise(Queue.shutdown(q)); // 泵随队列终结自然退出
      patchStatus("ended", null);
    },
    pause() {
      if (!running) return;
      running = false;
      takeover();
      patchStatus("paused", null); // 从游标续订：cursor 保留在闭包
    },
    resume() {
      if (running) return;
      start();
    },
    restart() {
      running = true;
      attempt = 0; // 手动重连重置退避预算
      void drive(takeover());
    },
    resync(anchor) {
      frames = [];
      framesCache = null;
      cursor = anchor === undefined ? null : anchor;
      state = { status: state.status, error: null, resyncs: state.resyncs + 1 };
      for (const listener of stateListeners) listener();
      running = true;
      attempt = 0;
      void drive(takeover());
    },
    clear() {
      frames = [];
      framesCache = null;
      for (const listener of frameListeners) listener();
    },

    onFrame(callback) {
      frameCallbacks.add(callback);
      return () => frameCallbacks.delete(callback);
    },
    subscribeStatus(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    getState() {
      return state;
    },
    subscribeFrames(listener) {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    getFrames() {
      if (framesCache === null) framesCache = [...frames];
      return framesCache;
    },
  };
}
