import type { ApiError, Cursor, FrameSource, Transport } from "../kernel";

/**
 * mockTransport —— Transport 契约的内存实现（测试工具 + demo 数据源）。
 *
 * 命令式控制（emit/interrupt/close/failNext）作用于**当前连接**（最近一次 open）；
 * 控制落在已被引擎 abort 的死连接上时静默丢弃——现实语义：重连间隙发出的帧就是丢了。
 *
 * 自动模式（demo events 流）：每次 open 按 intervalMs 递增 seq 生成帧；
 * 引擎带游标重开时从 seqOfCursor(cursor)+1 续发（backlog→follow 的续订方言）。
 */

export interface MockTransportHandle<F> {
  /** 向当前连接递送一帧 */
  emit(frame: F): void;
  /** 当前连接以未知错误中断（引擎按 backoffMs 重连） */
  interrupt(): void;
  /** 当前连接正常收流，上报 closeReason（终态分诊入口） */
  close(reason: FrameSource<F>["closeReason"]): void;
  gap(): void;
  end(): void;
  /** 下一次 open 立即抛出该 ApiError（auth 闭环/不可重试失败测试） */
  failNext(error: ApiError): void;
  /** open 调用记录（含游标快照，供断言重连/续订行为） */
  readonly opens: ReadonlyArray<{ cursor: Cursor | null }>;
}

export interface MockTransportOptions<F> {
  /** 帧游标投影（供引擎恢复点；缺省不产生游标） */
  cursorOf?: (frame: F) => Cursor | undefined;
  /** 自动生成：按 seq 递增（手动 emit 与自动生成可并存） */
  auto?: {
    intervalMs: number;
    frame: (seq: number) => F;
    /** 起始 seq（无游标开流时） */
    startSeq?: number;
    /** 由游标解析续发起点；缺省 parseInt */
    seqOfCursor?: (cursor: Cursor) => number;
  };
}

type MockStep<F> =
  | { kind: "frame"; frame: F }
  | { kind: "close"; reason: FrameSource<F>["closeReason"] }
  | { kind: "fail"; error: unknown };

export type MockTransport<F> = Transport<F> & MockTransportHandle<F>;

class MockAbortError extends Error {
  constructor() {
    super("mock: aborted");
    this.name = "AbortError";
  }
}

export function mockTransport<F>(options: MockTransportOptions<F> = {}): MockTransport<F> {
  const opens: { cursor: Cursor | null }[] = [];
  const failQueue: ApiError[] = [];

  interface Conn {
    alive: boolean;
    reason: FrameSource<F>["closeReason"];
    steps: MockStep<F>[];
    waiters: Array<() => void>;
    timer: ReturnType<typeof setInterval> | null;
    detach(): void;
  }
  let active: Conn | null = null;

  /** 直接投递到指定连接（绕过 alive 检查——abort 也要能唤醒等待者） */
  function post(conn: Conn, step: MockStep<F>): void {
    conn.steps.push(step);
    conn.waiters.shift()?.();
  }

  /** 面向句柄控制：只投给活着的当前连接 */
  function send(step: MockStep<F>): void {
    if (active?.alive) post(active, step);
  }

  const handle: MockTransportHandle<F> = {
    emit: (frame) => send({ kind: "frame", frame }),
    interrupt: () => send({ kind: "fail", error: new TypeError("mock: connection reset") }),
    close: (reason) => send({ kind: "close", reason }),
    gap: () => handle.close("gapped"),
    end: () => handle.close("ended"),
    failNext: (error) => {
      failQueue.push(error);
    },
    get opens() {
      return opens;
    },
  };

  return {
    ...handle,
    open(cursor: Cursor | null, signal: AbortSignal): FrameSource<F> {
      opens.push({ cursor });
      const failure = failQueue.shift();
      if (failure) throw failure;

      const auto = options.auto;
      const conn: Conn = {
        alive: true,
        reason: "transport",
        steps: [],
        waiters: [],
        timer: null,
        detach() {
          conn.alive = false;
          if (conn.timer) clearInterval(conn.timer);
          signal.removeEventListener("abort", abort);
          // 唤醒所有等待者：它们会看到 steps 空 + 已死 → done（防提前 return 挂起）
          for (const wake of conn.waiters.splice(0)) wake();
        },
      };
      active = conn;

      const abort = () => {
        if (!conn.alive) return;
        conn.detach();
        post(conn, { kind: "fail", error: new MockAbortError() });
      };
      signal.addEventListener("abort", abort, { once: true });

      if (auto) {
        const seqOfCursor = auto.seqOfCursor ?? ((c: Cursor) => Number.parseInt(c, 10));
        let seq = cursor === null ? (auto.startSeq ?? 0) : seqOfCursor(cursor) + 1;
        conn.timer = setInterval(() => {
          if (!conn.alive) return;
          send({ kind: "frame", frame: auto.frame(seq) });
          seq += 1;
        }, auto.intervalMs);
      }

      const iterator: AsyncIterator<F> = {
        async next(): Promise<IteratorResult<F>> {
          while (conn.steps.length === 0 && conn.alive) {
            await new Promise<void>((resolve) => {
              conn.waiters.push(resolve);
            });
          }
          const step = conn.steps.shift();
          if (step === undefined) return { done: true, value: undefined };
          if (step.kind === "frame") return { done: false, value: step.frame };
          conn.detach();
          if (step.kind === "close") {
            conn.reason = step.reason;
            return { done: true, value: undefined };
          }
          throw step.error;
        },
        async return(): Promise<IteratorResult<F>> {
          conn.detach();
          return { done: true, value: undefined };
        },
      };

      return {
        [Symbol.asyncIterator]: () => iterator,
        get closeReason() {
          return conn.reason;
        },
      };
    },
  };
}

/** 数字帧的便捷构造（测试：seq 即帧即游标）。 */
export function mockSeqTransport(
  options: { intervalMs?: number; startSeq?: number } = {},
): MockTransport<number> {
  return mockTransport<number>({
    cursorOf: (frame) => String(frame),
    auto: options.intervalMs
      ? { intervalMs: options.intervalMs, frame: (seq) => seq, startSeq: options.startSeq ?? 0 }
      : undefined,
  });
}
