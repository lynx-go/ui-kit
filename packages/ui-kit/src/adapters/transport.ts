import type { ApiError, Cursor, FrameSource, Transport } from "../kernel";

/**
 * 通用传输适配器（kernel Transport 契约 → fetch 流）。
 *
 * 终态分诊裁决落点（design.md §2.3）：NDJSON-over-fetch 的"收流"与"中断"
 * 在传输层不可严格区分——真终态判据是帧内容，由消费方经 isEnded 上报；
 * body 结束而不满足 isEnded ⇒ 抛错（引擎按退避重连）。SSE 同理：具名 endEvent
 * 是唯一"服务端收流"判据，连接断开一律按传输中断处理。
 * 票据/base64/protojson 的帧解码归消费方（decode 参数）。
 */

type UrlBuilder = string | ((cursor: Cursor | null) => string);

function buildUrl(url: UrlBuilder, cursor: Cursor | null): string {
  if (typeof url === "function") return url(cursor);
  if (cursor === null) return url;
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}cursor=${encodeURIComponent(cursor)}`;
}

async function fetchOrApiError(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (cause) {
    throw { kind: "network", cause } satisfies ApiError;
  }
  if (!response.ok) {
    if (response.status === 401) throw { kind: "auth" } satisfies ApiError;
    if (response.status === 403) throw { kind: "forbidden" } satisfies ApiError;
    if (response.status === 404) throw { kind: "not-found" } satisfies ApiError;
    let message: string | undefined;
    try {
      const body = (await response.json()) as { message?: unknown; error?: { message?: unknown } };
      if (typeof body.message === "string") message = body.message;
      else if (typeof body.error?.message === "string") message = body.error.message;
    } catch {
      // 非 JSON 错误体
    }
    throw {
      kind: "server",
      status: response.status,
      ...(message ? { message } : {}),
    } satisfies ApiError;
  }
  return response;
}

class TransportInterrupt extends Error {
  constructor(detail: string) {
    super(`@lynx-go/ui-kit: transport interrupted (${detail})`);
  }
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // 流已出错/关闭——无需解锁
  }
}

/** 收流即取消（含释放锁）；已结束/已中断的流上 cancel 可能拒绝，静默。 */
async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    releaseReader(reader);
  }
}

// ============ ndjsonTransport（fleetly 日志流方言） ============

export interface NdjsonTransportOptions<F> {
  url: UrlBuilder;
  /** 缺省 JSON.parse；票据/base64/protojson 行解码在消费方 */
  decode?: (line: string) => F;
  /** fetch 注入（测试/demo）；缺省 globalThis.fetch */
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  /**
   * 收流判据：body 正常结束且最后一帧满足 ⇒ closeReason "ended"（部署终态、日志关窗）；
   * 缺省恒 false——body 结束一律按传输中断（引擎重连）。
   */
  isEnded?: (lastFrame: F) => boolean;
}

export function ndjsonTransport<F>(options: NdjsonTransportOptions<F>): Transport<F> {
  const decode = options.decode ?? ((line: string) => JSON.parse(line) as F);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    open(cursor: Cursor | null, signal: AbortSignal): FrameSource<F> {
      let closeReason: FrameSource<F>["closeReason"] = "transport";

      const self = {
        get closeReason() {
          return closeReason;
        },
        async *[Symbol.asyncIterator](): AsyncIterator<F> {
          const response = await fetchOrApiError(
            buildUrl(options.url, cursor),
            { headers: options.headers, signal },
            fetchImpl,
          );
          if (response.body === null) throw new TransportInterrupt("no body");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let lastFrame: F | undefined;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let newline = buffer.indexOf("\n");
              while (newline >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (line.length > 0) {
                  lastFrame = decode(line);
                  yield lastFrame;
                }
                newline = buffer.indexOf("\n");
              }
            }
            const tail = (buffer + decoder.decode()).trim();
            if (tail.length > 0) {
              lastFrame = decode(tail);
              yield lastFrame;
            }
          } finally {
            await cancelReader(reader);
          }
          // body 结束：真终态判据是帧内容（§2.3 裁决），否则按中断抛错交引擎重连
          if (lastFrame !== undefined && options.isEnded?.(lastFrame) === true) {
            closeReason = "ended";
            return;
          }
          throw new TransportInterrupt("ndjson body ended without end frame");
        },
      };
      return self;
    },
  };
}

// ============ sseTransport（具名事件方言） ============

export interface SseMessage {
  event: string;
  data: string;
  /** 最后一次 id: 字段——SSE 的原生续订游标 */
  id?: string;
}

export interface SseTransportOptions<F> {
  url: UrlBuilder;
  /** 缺省 JSON.parse(data)；消费方可按 event 分派类型化帧 */
  decode?: (message: SseMessage) => F;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  /** 收流判据：收到该具名事件 ⇒ closeReason "ended"；缺省无（断开一律重连） */
  endEvent?: string;
}

export function sseTransport<F>(options: SseTransportOptions<F>): Transport<F> {
  const decode =
    options.decode ?? ((message: SseMessage) => JSON.parse(message.data) as unknown as F);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    open(cursor: Cursor | null, signal: AbortSignal): FrameSource<F> {
      let closeReason: FrameSource<F>["closeReason"] = "transport";

      const self = {
        get closeReason() {
          return closeReason;
        },
        async *[Symbol.asyncIterator](): AsyncIterator<F> {
          const response = await fetchOrApiError(
            buildUrl(options.url, cursor),
            { headers: { Accept: "text/event-stream", ...options.headers }, signal },
            fetchImpl,
          );
          if (response.body === null) throw new TransportInterrupt("no body");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let ended = false;

          /** 解析一个 SSE 块（行集合）；endEvent 命中时置 ended。 */
          const dispatch = (block: string, out: F[]): void => {
            const message: SseMessage = { event: "message", data: "" };
            const dataLines: string[] = [];
            for (const rawLine of block.split("\n")) {
              const line = rawLine.replace(/\r$/, "");
              if (line === "" || line.startsWith(":")) continue;
              const colon = line.indexOf(":");
              const field = colon < 0 ? line : line.slice(0, colon);
              let value = colon < 0 ? "" : line.slice(colon + 1);
              if (value.startsWith(" ")) value = value.slice(1);
              if (field === "data") dataLines.push(value);
              else if (field === "event") message.event = value;
              else if (field === "id") message.id = value;
            }
            if (options.endEvent !== undefined && message.event === options.endEvent) {
              ended = true; // 无 data 载荷的收流事件也成立（endEvent 判定先于 data 必有检查）
              return;
            }
            if (dataLines.length === 0) return;
            message.data = dataLines.join("\n");
            out.push(decode(message));
          };

          /** 按 \n\n 切块；final=true 时处理无尾空行的末块；ended 后停止分派。 */
          const emitBlocks = (chunk: string, final: boolean): F[] => {
            buffer += chunk;
            const frames: F[] = [];
            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0 && !ended) {
              dispatch(buffer.slice(0, boundary), frames);
              buffer = buffer.slice(boundary + 2);
              boundary = buffer.indexOf("\n\n");
            }
            if (final && !ended && buffer.trim().length > 0) {
              dispatch(buffer, frames);
              buffer = "";
            }
            return frames;
          };

          try {
            while (!ended) {
              const { done, value } = await reader.read();
              if (done) {
                for (const frame of emitBlocks(decoder.decode(), true)) yield frame;
                break;
              }
              for (const frame of emitBlocks(decoder.decode(value, { stream: true }), false)) {
                yield frame;
              }
            }
          } finally {
            await cancelReader(reader);
          }
          if (ended) {
            closeReason = "ended";
            return;
          }
          throw new TransportInterrupt("sse stream closed without end event");
        },
      };
      return self;
    },
  };
}
