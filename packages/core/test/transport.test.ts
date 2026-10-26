import { describe, expect, test } from "vitest";
import { mockTransport } from "../src/adapters/mock-transport";
import { ndjsonTransport, sseTransport } from "../src/adapters/transport";
import type { FrameSource } from "../src/kernel";

function ndjsonResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

/** 消费 FrameSource 直到迭代器结束，收集帧与 closeReason。 */
async function drain<F>(source: FrameSource<F>): Promise<{ frames: F[]; closeReason: string }> {
  const frames: F[] = [];
  try {
    for await (const frame of source) frames.push(frame);
  } catch {
    // 抛错 = 传输中断语义（引擎消费时走重连）；此处只测正常收流路径
    return { frames, closeReason: "throw" };
  }
  return { frames, closeReason: source.closeReason };
}

describe("ndjsonTransport", () => {
  test("跨 chunk 的行切分与尾行（无换行结尾）；无 isEnded → body 结束按中断抛错", async () => {
    const transport = ndjsonTransport<{ n: number }>({
      url: "https://x.test/logs",
      fetchImpl: async () => ndjsonResponse(['{"n":1}\n{"n"', ':2}\n{"n":3}', "\n", '{"n":4}']),
    });
    const iterator = transport.open(null, new AbortController().signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ n: 1 });
    expect((await iterator.next()).value).toEqual({ n: 2 });
    expect((await iterator.next()).value).toEqual({ n: 3 });
    expect((await iterator.next()).value).toEqual({ n: 4 });
    // §2.3 裁决：NDJSON 收流/中断在传输层不可分——无帧级终态判据时 body 结束 = 中断
    await expect(iterator.next()).rejects.toThrow(/interrupted/);
  });

  test("isEnded 满足 → closeReason ended（部署终态/日志关窗由帧内容裁决）", async () => {
    const transport = ndjsonTransport<{ state: string }>({
      url: "https://x.test/logs",
      fetchImpl: async () => ndjsonResponse(['{"state":"running"}\n{"state":"done"}\n']),
      isEnded: (frame) => frame.state === "done",
    });
    const { frames, closeReason } = await drain(transport.open(null, new AbortController().signal));
    expect(frames).toEqual([{ state: "running" }, { state: "done" }]);
    expect(closeReason).toBe("ended");
  });

  test("cursor 附加进 URL；401 → auth；503 → server（isRetryable 走退避）", async () => {
    let seenUrl = "";
    const transport = ndjsonTransport<{ n: number }>({
      url: (cursor) => `https://x.test/logs?after=${cursor ?? "head"}`,
      fetchImpl: async (input) => {
        seenUrl = String(input);
        return ndjsonResponse(['{"n":1}\n']);
      },
    });
    await drain(transport.open("seq-9", new AbortController().signal));
    expect(seenUrl).toBe("https://x.test/logs?after=seq-9");

    const failing = ndjsonTransport({
      url: "https://x.test/logs",
      fetchImpl: async () => new Response("nope", { status: 401 }),
    });
    await expect(async () => {
      for await (const _ of failing.open(null, new AbortController().signal)) void _;
    }).rejects.toEqual({ kind: "auth" });

    const serverDown = ndjsonTransport({
      url: "https://x.test/logs",
      fetchImpl: async () => new Response("boom", { status: 503 }),
    });
    await expect(async () => {
      for await (const _ of serverDown.open(null, new AbortController().signal)) void _;
    }).rejects.toEqual({ kind: "server", status: 503 });
  });

  test("abort → AbortError 出界（引擎据此区分主动取消）", async () => {
    const encoder = new TextEncoder();
    const abortCtl = new AbortController();
    let streamCtl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        streamCtl = c;
        c.enqueue(encoder.encode('{"n":1}\n')); // 不 close：模拟长连接
      },
    });
    const transport = ndjsonTransport<{ n: number }>({
      url: "https://x.test/logs",
      fetchImpl: async (_url, init) => {
        // 真实 fetch 会把 init.signal 桥到 body 流错误；此处手工模拟同等语义
        init?.signal?.addEventListener("abort", () => {
          streamCtl.error(new DOMException("Aborted", "AbortError"));
        });
        return new Response(stream, { status: 200 });
      },
    });
    const source = transport.open(null, abortCtl.signal);
    const iterator = source[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: { n: 1 } });
    abortCtl.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("sseTransport", () => {
  test("具名事件 + id + 注释行；事件块跨 chunk 切分", async () => {
    const transport = sseTransport<{ event: string; data: unknown; id?: string }>({
      url: "https://x.test/events",
      fetchImpl: async () =>
        ndjsonResponse([
          ": heartbeat\n\n",
          'event: created\ndata: {"a":1}\nid: 7\n\n',
          'event: patched\ndata: {"b":', // 事件跨 chunk 边界
          "2}\n\n",
        ]),
      decode: (message) => ({
        event: message.event,
        data: JSON.parse(message.data),
        id: message.id,
      }),
    });
    const { frames } = await drain(transport.open(null, new AbortController().signal));
    expect(frames).toEqual([
      { event: "created", data: { a: 1 }, id: "7" },
      { event: "patched", data: { b: 2 } },
    ]);
  });

  test("多行 data 以 \\n 连接（SSE 规范），解码归消费方", async () => {
    const transport = sseTransport<string>({
      url: "https://x.test/e",
      fetchImpl: async () => ndjsonResponse(["data: line1\ndata: line2\n\n"]),
      decode: (message) => message.data,
    });
    const { frames } = await drain(transport.open(null, new AbortController().signal));
    expect(frames).toEqual(["line1\nline2"]);
  });

  test("endEvent 命中 → closeReason ended（无 data 载荷也成立）；断开无 endEvent → 抛中断", async () => {
    const endedTransport = sseTransport<unknown>({
      url: "https://x.test/e",
      fetchImpl: async () => ndjsonResponse(["event: end\n\n"]),
      endEvent: "end",
    });
    const { closeReason } = await drain(endedTransport.open(null, new AbortController().signal));
    expect(closeReason).toBe("ended");

    const interrupted = sseTransport<unknown>({
      url: "https://x.test/e",
      fetchImpl: async () => ndjsonResponse(['data: {"x":1}\n\n']),
    });
    const iterator = interrupted.open(null, new AbortController().signal)[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: { x: 1 } });
    await expect(iterator.next()).rejects.toThrow(/interrupted/);
  });
});

describe("mockTransport 契约", () => {
  test("open 记录游标；cursorOf 续发（auto 模式 seqOfCursor+1）", async () => {
    const mock = mockTransport<{ seq: number; v: string }>({
      cursorOf: (f) => String(f.seq),
      auto: { intervalMs: 15, frame: (seq) => ({ seq, v: `v${seq}` }) },
    });
    const engine = { frames: [] as { seq: number; v: string }[] };

    // 直接消费 transport（quickstart 命令式用法）：cursor "3" → 从 seq 4 续发
    const iterator = mock.open("3", new AbortController().signal)[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toEqual({ seq: 4, v: "v4" });
    void engine;
    await iterator.return?.();
  });

  test("emit/gap/end/interrupt/failNext 作用于当前连接；abort 后控制丢弃", async () => {
    const mock = mockTransport<number>();
    const controller = new AbortController();
    const source = mock.open(null, controller.signal);
    const iterator = source[Symbol.asyncIterator]();
    const nextPromise = iterator.next();
    mock.emit(1);
    expect((await nextPromise).value).toBe(1);
    expect(mock.opens).toEqual([{ cursor: null }]);

    mock.emit(2); // 有等待者时直接唤醒
    expect((await iterator.next()).value).toBe(2);

    controller.abort(); // 引擎主动取消：等待中的迭代以 AbortError 出界
    mock.emit(3); // 死连接：丢弃，不炸
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });

    mock.emit(4); // 仍丢弃
    expect(mock.opens.length).toBe(1);
  });

  test("close(reason) 反映进 closeReason（终态分诊上报）", async () => {
    const mock = mockTransport<number>();
    const source = mock.open(null, new AbortController().signal);
    const iterator = source[Symbol.asyncIterator]();
    const nextPromise = iterator.next();
    mock.end();
    expect(await nextPromise).toEqual({ done: true, value: undefined });
    expect(source.closeReason).toBe("ended");
  });
});
