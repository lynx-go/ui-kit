import { describe, expect, test } from "vitest";
import { mockSeqTransport, mockTransport } from "../src/adapters/mock-transport";
import { createSubscriptionEngine } from "../src/adapters/subscription";
import type { ApiError, SubscriptionStatus, Transport } from "../src/kernel";

/** 轮询等待引擎进入目标状态（时间断言用短退避，CI 安全）。 */
async function waitForStatus(
  engine: { getState(): { status: SubscriptionStatus } },
  status: SubscriptionStatus,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (engine.getState().status !== status) {
    if (Date.now() > deadline) {
      throw new Error(`waitForStatus("${status}") timed out; at ${engine.getState().status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** live = open 成功：等连接建立后再注入控制（emit 落在未建立的连接上会被丢弃——现实语义）。 */
async function untilLive(engine: { getState(): { status: SubscriptionStatus } }): Promise<void> {
  await waitForStatus(engine, "live");
}

/** 等第 n 次 open 发生——重连类断言的确定性信号（状态翻转有微任务延迟）。 */
async function waitForOpens(
  mock: { opens: ReadonlyArray<{ cursor: string | null }> },
  count: number,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (mock.opens.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`waitForOpens(${count}) timed out at ${mock.opens.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function framesSettle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe("订阅引擎：帧递送与环形缓冲", () => {
  test("帧经引擎进入缓冲；buffer 超限丢最旧", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({
      transport: mock,
      policy: { buffer: 3 },
    });
    await untilLive(engine);
    mock.emit(1);
    mock.emit(2);
    mock.emit(3);
    mock.emit(4);
    mock.emit(5);
    await framesSettle();
    expect(engine.getFrames()).toEqual([3, 4, 5]);
    expect(engine.frames).toBe(engine.getFrames()); // 快照引用稳定（uSES 契约）
    engine.stop();
  });

  test("getFrames 快照在帧到达后引用更替", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({ transport: mock, policy: { buffer: 10 } });
    await untilLive(engine);
    mock.emit(1);
    await framesSettle();
    const before = engine.getFrames();
    mock.emit(2);
    await framesSettle();
    const after = engine.getFrames();
    expect(before).toEqual([1]);
    expect(after).toEqual([1, 2]);
    expect(after).not.toBe(before);
    engine.stop();
  });

  test("onFrame 回调 + 退订", async () => {
    const mock = mockTransport<number>();
    const seen: number[] = [];
    const engine = createSubscriptionEngine<number>({
      transport: mock,
      onFrame: (f) => seen.push(f),
    });
    const off = engine.onFrame((f) => seen.push(f * 10));
    await untilLive(engine);
    mock.emit(7);
    await framesSettle();
    off();
    mock.emit(8);
    await framesSettle();
    expect(seen).toEqual([7, 70, 8]);
    engine.stop();
  });

  test("未启动（autoStart:false）不开连接；start 后正常", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({ transport: mock, autoStart: false });
    await framesSettle();
    expect(mock.opens.length).toBe(0);
    engine.start();
    await untilLive(engine);
    expect(mock.opens.length).toBe(1);
    engine.stop();
  });
});

describe("订阅引擎：终态分诊矩阵（closeReason 归 transport）", () => {
  test("ended → status ended", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({ transport: mock });
    await untilLive(engine);
    mock.emit(1);
    mock.end();
    await waitForStatus(engine, "ended");
    expect(engine.getFrames()).toEqual([1]);
    engine.stop();
  });

  test("gapped → status gapped（不自动重跑 backlog，页面负责 resync）", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({ transport: mock });
    await untilLive(engine);
    mock.gap();
    await waitForStatus(engine, "gapped");
    engine.stop();
  });

  test("closeReason auth → error{kind:auth}", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({ transport: mock });
    await untilLive(engine);
    mock.close("auth");
    await waitForStatus(engine, "error");
    expect(engine.getState().error).toEqual({ kind: "auth" });
    engine.stop();
  });

  test("closeReason transport → error{kind:network}", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({ transport: mock });
    await untilLive(engine);
    mock.close("transport");
    await waitForStatus(engine, "error");
    expect(engine.getState().error).toEqual({ kind: "network" });
    engine.stop();
  });

  test("open 抛不可重试 ApiError → error 状态（401 闭环在订阅侧的落点）", async () => {
    const mock = mockTransport<number>();
    mock.failNext({ kind: "auth" } satisfies ApiError);
    const engine = createSubscriptionEngine<number>({ transport: mock });
    await waitForStatus(engine, "error");
    expect(engine.getState().error).toEqual({ kind: "auth" });
    engine.stop();
  });

  test("open 抛可重试 ApiError（server）→ 走退避而非 error", async () => {
    const mock = mockTransport<number>();
    mock.failNext({ kind: "server", status: 503 } satisfies ApiError);
    const engine = createSubscriptionEngine<number>({
      transport: mock,
      policy: { buffer: 10, retry: { backoffMs: [10] } },
    });
    await untilLive(engine); // 退避后重开成功（503 只消耗一档退避，不是终态）
    expect(mock.opens.length).toBe(2);
    engine.stop();
  });
});

describe("订阅引擎：退避序列与 stalled", () => {
  test("中断 → backoffMs 序列重连；预算耗尽 → stalled；restart 重置预算", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({
      transport: mock,
      policy: { buffer: 10, retry: { backoffMs: [10, 20] } },
    });
    await untilLive(engine);

    mock.interrupt(); // 第 1 次中断 → 10ms 后重连
    await waitForOpens(mock, 2);
    mock.interrupt(); // 第 2 次中断 → 20ms 后重连
    await waitForOpens(mock, 3);
    mock.interrupt(); // 第 3 次中断 → 预算耗尽
    await waitForStatus(engine, "stalled");
    expect(mock.opens.length).toBe(3); // 不再 open

    engine.restart(); // 手动重连重置预算
    await waitForOpens(mock, 4);
    engine.stop();
  });

  test("帧恢复后退避归零（每次断线从 backoffMs[0] 重新计数）", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({
      transport: mock,
      policy: { buffer: 10, retry: { backoffMs: [10, 20, 30] } },
    });
    await untilLive(engine);
    mock.emit(1);
    await framesSettle();

    for (let round = 1; round <= 4; round++) {
      mock.interrupt();
      await waitForOpens(mock, round + 1); // 每轮都只消耗第 0 档
      mock.emit(round + 1); // 新连接递送帧 → 退避归零
      await framesSettle();
    }
    expect(mock.opens.length).toBe(5); // 首连 + 4 次重连，从未耗尽
    engine.stop();
  });

  test("beforeReconnect 在重连前调用（refresh→重订落点），重连带游标续订", async () => {
    const mock = mockTransport<number>();
    const order: string[] = [];
    const transport: Transport<number> = {
      open: (cursor, signal) => {
        order.push(`open:${cursor ?? "null"}`);
        return mock.open(cursor, signal);
      },
      beforeReconnect: async () => {
        order.push("refresh");
      },
    };
    const engine = createSubscriptionEngine<number>({
      transport,
      getCursor: (frame) => String(frame),
      policy: { buffer: 10, retry: { backoffMs: [5] } },
    });
    await untilLive(engine);
    mock.emit(1);
    await framesSettle();
    mock.interrupt();
    await waitForOpens(mock, 2);
    expect(order).toEqual([
      "open:null",
      "refresh", // 重连前
      "open:1", // 且带最后帧游标续订
    ]);
    engine.stop();
  });
});

describe("订阅引擎：pause/resume/restart/resync/clear", () => {
  test("暂停不误判为重连（AbortError 与传输错误区分）", async () => {
    const mock = mockSeqTransport({ intervalMs: 200, startSeq: 100 });
    const engine = createSubscriptionEngine<number>({
      transport: mock,
      getCursor: (frame) => String(frame),
      policy: { buffer: 100 },
    });
    await untilLive(engine);
    await framesSettle();

    engine.pause();
    await waitForStatus(engine, "paused");
    const frozen = engine.getFrames().length;
    await framesSettle();
    expect(engine.getFrames().length).toBe(frozen); // 暂停不进帧
    expect(mock.opens.length).toBe(1);
    engine.stop();
  });

  test("resume 从最后帧游标续订", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({
      transport: mock,
      getCursor: (frame) => String(frame),
      policy: { buffer: 10 },
    });
    await untilLive(engine);
    mock.emit(5);
    await framesSettle();
    engine.pause();
    await waitForStatus(engine, "paused");
    engine.resume();
    await untilLive(engine);
    expect(mock.opens[mock.opens.length - 1]!.cursor).toBe("5");
    engine.stop();
  });

  test("resync：清缓冲 + 从新锚点重开 + resyncs 计数（黄条信号）", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({
      transport: mock,
      getCursor: (f) => String(f),
      policy: { buffer: 10 },
    });
    await untilLive(engine);
    mock.emit(1);
    mock.emit(2);
    await framesSettle();
    mock.gap();
    await waitForStatus(engine, "gapped");
    expect(engine.getFrames()).toEqual([1, 2]);

    engine.resync("99"); // 页面重跑 backlog 后以新锚点重订
    await untilLive(engine);
    expect(engine.getFrames()).toEqual([]); // 缓冲已清
    expect(engine.resyncs).toBe(1);
    expect(mock.opens[mock.opens.length - 1]!.cursor).toBe("99");
    engine.stop();
  });

  test("clear 只清缓冲不动连接", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({ transport: mock, policy: { buffer: 10 } });
    await untilLive(engine);
    mock.emit(1);
    await framesSettle();
    engine.clear();
    expect(engine.getFrames()).toEqual([]);
    expect(engine.status).toBe("live");
    mock.emit(2); // 连接仍在
    await framesSettle();
    expect(engine.getFrames()).toEqual([2]);
    engine.stop();
  });

  test("stop → ended；缓冲保留可读", async () => {
    const mock = mockTransport<number>();
    const engine = createSubscriptionEngine<number>({ transport: mock });
    await untilLive(engine);
    mock.emit(1);
    await framesSettle();
    engine.stop();
    await waitForStatus(engine, "ended");
    expect(engine.getFrames()).toEqual([1]);
  });
});

describe("订阅引擎：StrictMode 双挂载幂等（快速 stop/start 接力）", () => {
  test("boot 途中 stop 不泄漏队列；重建引擎各自独立", async () => {
    const mockA = mockTransport<number>();
    const engineA = createSubscriptionEngine<number>({ transport: mockA });
    engineA.stop(); // 立即卸载（boot 的 ensureQueue 尚未完成）

    const mockB = mockTransport<number>();
    const engineB = createSubscriptionEngine<number>({
      transport: mockB,
      policy: { buffer: 10 },
    });
    await untilLive(engineB);
    mockB.emit(1);
    await framesSettle();
    expect(engineB.getFrames()).toEqual([1]);
    expect(engineA.status).toBe("ended");
    engineB.stop();
  });
});
