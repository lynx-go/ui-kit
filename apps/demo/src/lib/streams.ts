import { mockCollection, mockTransport, ndjsonTransport } from "@fleetly/fleet-ui-kit/adapters";
import type { SubscriptionDescriptor } from "@fleetly/fleet-ui-kit/kernel";
import { defineResource } from "@fleetly/fleet-ui-kit/kernel";
import { collectionQuerySchema } from "@fleetly/fleet-ui-kit/schema";

// ============ events：backlog Query 定锚 × Subscription 续订（fleetly events 方言模拟） ============

export interface EventFrame {
  id: string;
  seq: number;
  type: "created" | "patched" | "scaled" | "deleted";
  actor: string;
  message: string;
  at: string;
}

const ACTORS = ["ada", "grace", "linus", "barbara"];
const TYPES: EventFrame["type"][] = ["created", "patched", "scaled", "deleted"];
const OBJECTS = ["widget-101", "widget-102", "widget-205", "app-42", "app-43", "route-7"];

const makeEvent = (seq: number, atMs: number): EventFrame => ({
  id: `evt-${seq}`,
  seq,
  type: TYPES[seq % TYPES.length]!,
  actor: ACTORS[seq % ACTORS.length]!,
  message: `${OBJECTS[seq % OBJECTS.length]} ${TYPES[seq % TYPES.length]} by console`,
  at: new Date(atMs).toISOString(),
});

/** backlog 种子：seq 升序造、资源按 seq 倒序读（最新一端即锚——§2.3 锚点交接） */
const SEED = 24;
const START_SEQ = 100;
const seedEvents: EventFrame[] = Array.from({ length: SEED }, (_, i) =>
  makeEvent(START_SEQ + i, Date.now() - (SEED - i) * 45_000),
);

const eventsMock = mockCollection(seedEvents, { dialect: "offset", latencyMs: 80 });

/** live 帧回写 backlog 存储（重锚时 fetchQuery 才能拿到推进后的锚——否则新锚永远停在种子 seq） */
const liveRows: EventFrame[] = [];
export function appendLiveEvent(frame: EventFrame): void {
  liveRows.unshift(frame);
  eventsMock.handle.replaceRows([...liveRows, ...seedEvents]);
}

export const eventsResource = defineResource({
  name: "events",
  getId: (row) => row.id,
  collection: eventsMock.collection,
});

export const eventsSearch = collectionQuerySchema({
  defaultSize: 20,
  defaultOrder: [{ field: "seq", dir: "desc" }],
});

/** 锚点方言吸收（§2.3）：backlog 最新一端 = 锚；这里即 rows[0].seq（倒序第一行） */
export const anchorOf = (rows: ReadonlyArray<EventFrame>): string | null =>
  rows.length > 0 ? String(rows[0]!.seq) : null;

/** live 流：自动按 seq 续发；断档/终态由页面按钮注入（demo 专属句柄） */
export const eventsMockTransport = mockTransport<EventFrame>({
  cursorOf: (frame) => String(frame.seq),
  auto: {
    intervalMs: 1200,
    frame: (seq) => makeEvent(seq, Date.now()),
    startSeq: START_SEQ + SEED, // 无锚开流（防御；demo 恒带锚）
  },
});

/** SubscriptionDescriptor 形态（Resource.subscriptions 条目同款）：policy 声明在流侧 */
export const eventsStream: SubscriptionDescriptor<void, EventFrame> = {
  open: () => eventsMockTransport,
  policy: { buffer: 60, retry: { backoffMs: [400, 800, 1600] } },
};

// ============ stages：部署阶段时间线（StageTimeline 参照实现的 demo 数据源） ============

export interface StageFrame {
  key: string;
  status: "active" | "done" | "failed";
  at: string;
  note?: string;
}

/** 阶段目录（先验次序；文案走页面——块不认业务名词） */
export const DEPLOY_STAGES = [
  { key: "queued", label: "Queued" },
  { key: "build", label: "Build image" },
  { key: "push", label: "Push image" },
  { key: "deploy", label: "Roll out replicas" },
  { key: "verify", label: "Health checks" },
] as const;

/** 一次运行的脚本：相对时刻 → 阶段事件；跑完正常收流（closeReason "ended"） */
const RUN_SCRIPT: ReadonlyArray<{ afterMs: number; event: Omit<StageFrame, "at"> }> = [
  { afterMs: 200, event: { key: "queued", status: "done", note: "picked up by builder" } },
  { afterMs: 500, event: { key: "build", status: "active", note: "layer cache warm" } },
  { afterMs: 2400, event: { key: "build", status: "done" } },
  { afterMs: 2500, event: { key: "push", status: "active", note: "pushing image" } },
  { afterMs: 4300, event: { key: "push", status: "done" } },
  { afterMs: 4400, event: { key: "deploy", status: "active", note: "rolling 3 replicas" } },
  { afterMs: 6600, event: { key: "deploy", status: "done" } },
  { afterMs: 6700, event: { key: "verify", status: "active", note: "probes 0/3" } },
  { afterMs: 7600, event: { key: "verify", status: "done", note: "probes 3/3" } },
];

/** 脚本驱动器：emit 按时刻表推进，收尾 end()（页面挂载/重启按钮调用） */
export function createStageScript(transport: { emit(frame: StageFrame): void; end(): void }) {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let runId = 0;
  return {
    run(): void {
      runId += 1;
      const id = runId;
      for (const timer of timers) clearTimeout(timer);
      timers = [];
      for (const step of RUN_SCRIPT) {
        timers.push(
          setTimeout(() => {
            if (id !== runId) return;
            transport.emit({ ...step.event, at: new Date().toISOString() });
          }, step.afterMs),
        );
      }
      timers.push(
        setTimeout(() => {
          if (id === runId) transport.end();
        }, 8200),
      );
    },
    stop(): void {
      runId += 1;
      for (const timer of timers) clearTimeout(timer);
      timers = [];
    },
  };
}

/** 阶段流 transport：无自动生成，帧完全由脚本注入 */
export const stagesMockTransport = mockTransport<StageFrame>();

// ============ logs：ndjsonTransport over mock fetch（fleetly 日志流方言模拟） ============

export interface LogFrame {
  ts: string;
  level: "info" | "warn" | "error";
  msg: string;
  /** 服务端收流判据（isEnded）——真终态判据是帧内容（§2.3 NDJSON 裁决） */
  final?: boolean;
}

const LOG_LINES = [
  "image layer cached",
  "starting container",
  "health check passing",
  "scaling replica set",
  "reconcile loop ticked",
  "config reloaded",
];

/**
 * mock 日志尾流：单一生成源，每次 fetch 挂一条新 ReadableStream；
 * abort 桥到流错误（真实 fetch 语义），finish 发送终帧并收流。
 */
export function createLogsSource(intervalMs = 900) {
  const encoder = new TextEncoder();
  let seq = 0;
  let active: ReadableStreamDefaultController<Uint8Array> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let prefaced = false;

  const emit = (frame: LogFrame): void => {
    active?.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
  };

  return {
    transport: ndjsonTransport<LogFrame>({
      url: "mock://deployments/dpl-9/logs",
      fetchImpl: async (_url: RequestInfo | URL, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            active = controller;
            if (!prefaced) {
              // 首连回放近期行（真实尾流行为；也让 follow 视图即刻可滚动）
              prefaced = true;
              for (let i = 0; i < 25; i += 1) {
                seq += 1;
                controller.enqueue(
                  encoder.encode(
                    `${JSON.stringify({
                      ts: new Date(Date.now() - (25 - i) * 1000).toISOString(),
                      level: "info",
                      msg: `historical line (#${seq})`,
                    })}\n`,
                  ),
                );
              }
            }
          },
        });
        init?.signal?.addEventListener("abort", () => {
          active?.error(new DOMException("Aborted", "AbortError"));
          active = null;
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/x-ndjson" },
        });
      },
      isEnded: (frame) => frame.final === true,
    }),
    /** 开始生成（页面挂载/重启按钮） */
    start(): void {
      if (timer !== null) return;
      timer = setInterval(() => {
        seq += 1;
        emit({
          ts: new Date().toISOString(),
          level: seq % 11 === 0 ? "warn" : seq % 17 === 0 ? "error" : "info",
          msg: `replica-${seq % 3} ${LOG_LINES[seq % LOG_LINES.length]} (#${seq})`,
        });
      }, intervalMs);
    },
    /** 服务端收流演示：终帧 + close → transport 报 closeReason "ended" */
    finish(): void {
      if (timer !== null) clearInterval(timer);
      timer = null;
      emit({
        ts: new Date().toISOString(),
        level: "info",
        msg: "deployment finished — stream closed by server",
        final: true,
      });
      active?.close();
      active = null;
    },
  };
}
