import { Data, Effect } from "effect";
import { isApiError, type ApiError } from "../kernel";

/**
 * 缝 1 —— http 管线（Effect 住在缝里，Promise 站在边界上）。
 *
 * - 网络断层 = typed failure（HttpFailure/NetworkFailure → ApiError），defect 只留程序错误；
 * - runApi 是唯一 Effect→Promise 边界：mapError 归一为 ApiError，defect 包裹上报，interrupt 放行；
 * - 401 闭环：管线内先走 onUnauthorized（单飞由实现方保证），仍失败才以 ApiError.auth 出界。
 */

export class HttpFailure extends Data.TaggedError("HttpFailure")<{
  readonly status: number;
  readonly body?: unknown;
}> {}

export class NetworkFailure extends Data.TaggedError("NetworkFailure")<{
  readonly cause?: unknown;
}> {}

type AdapterFailure = HttpFailure | NetworkFailure;

function extractMessage(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "object" && record.error !== null) {
      const inner = (record.error as Record<string, unknown>).message;
      if (typeof inner === "string") return inner;
    }
  }
  return undefined;
}

function toApiError(failure: AdapterFailure): ApiError {
  switch (failure._tag) {
    case "NetworkFailure":
      return { kind: "network", ...(failure.cause !== undefined ? { cause: failure.cause } : {}) };
    case "HttpFailure": {
      const { status, body } = failure;
      if (status === 401) return { kind: "auth" };
      if (status === 403) return { kind: "forbidden" };
      if (status === 404) return { kind: "not-found" };
      return { kind: "server", status, ...(extractMessage(body) ? { message: extractMessage(body) } : {}) };
    }
  }
}

/** 唯一边界：所有 Effect→Promise 只经它。 */
export function runApi<A>(eff: Effect.Effect<A, AdapterFailure>): Promise<A> {
  return Effect.runPromise(Effect.mapError(eff, toApiError)).catch(
    (err: unknown) =>
      new Promise<A>((_resolve, reject) => {
        if (isApiError(err)) {
          reject(err);
          return;
        }
        // defect（程序错误）——归一为可观测的包装，不混入 ApiError 封闭集
        reject(new Error("fleet-ui: unexpected defect in adapter pipeline", { cause: err }));
      }),
  );
}

export interface HttpOptions {
  baseUrl?: string;
  /** 401 handler 注册点（工厂参数，非全局 provider）。签名符合"清凭证+清缓存+跳登录"。 */
  onUnauthorized?: () => void | Promise<void>;
}

export type QueryParams = Record<string, string | number | boolean | ReadonlyArray<string>>;

export interface HttpRequest {
  params?: QueryParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 运行时解码（Effect Schema transform 接入点；缺省直通 as T） */
  decode?: (raw: unknown) => unknown;
}

function buildUrl(baseUrl: string | undefined, path: string, params?: QueryParams): string {
  const url = baseUrl ? `${baseUrl}${path}` : path;
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item); // repeated key=a&key=b（gateway 方言）
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

export function createHttp(options: HttpOptions = {}) {
  function requestJson(path: string, init: RequestInit & { params?: QueryParams }): Effect.Effect<unknown, AdapterFailure> {
    const url = buildUrl(options.baseUrl, path, init.params);
    return Effect.tryPromise({
      // 注意 arity 陷阱：单参数 signal（v4 按函数 length 探测）
      try: (signal) => fetch(url, { ...init, signal: init.signal ?? signal }),
      catch: (cause) => new NetworkFailure({ cause }),
    }).pipe(
      Effect.flatMap((response) =>
        Effect.suspend((): Effect.Effect<unknown, AdapterFailure> => {
          if (!response.ok) {
            return readBody(response).pipe(
              Effect.flatMap((body) => {
                const failure: AdapterFailure = new HttpFailure({
                  status: response.status,
                  ...(body !== undefined ? { body } : {}),
                });
                if (response.status === 401 && options.onUnauthorized) {
                  // 401 闭环：管线内先行 handler，仍失败才以 failure 出界
                  return Effect.tryPromise({
                    try: async () => {
                      await options.onUnauthorized?.();
                    },
                    catch: () => failure,
                  }).pipe(Effect.flatMap(() => Effect.fail(failure)));
                }
                return Effect.fail(failure);
              }),
            );
          }
          return Effect.tryPromise({
            try: () => response.json(),
            catch: () =>
              new HttpFailure({
                status: response.status,
                body: { message: `fleet-ui: response is not JSON (${path})` },
              }) as AdapterFailure,
          });
        }),
      ),
    );
  }

  function readBody(response: Response): Effect.Effect<unknown, AdapterFailure> {
    return Effect.tryPromise({
      try: () => response.json(),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined));
  }

  async function request<T>(method: string, path: string, req: HttpRequest & { body?: unknown }): Promise<T> {
    const headers: Record<string, string> = { ...req.headers };
    let body: BodyInit | undefined;
    if (req.body !== undefined) {
      headers["Content-Type"] ??= "application/json";
      body = JSON.stringify(req.body);
    }
    const raw = await runApi(
      requestJson(path, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(req.params ? { params: req.params } : {}),
        ...(req.signal ? { signal: req.signal } : {}),
      }),
    );
    return (req.decode ? req.decode(raw) : raw) as T;
  }

  return {
    get: <T>(path: string, req: HttpRequest = {}) => request<T>("GET", path, req),
    post: <T>(path: string, body: unknown, req: HttpRequest = {}) =>
      request<T>("POST", path, { ...req, body }),
    put: <T>(path: string, body: unknown, req: HttpRequest = {}) =>
      request<T>("PUT", path, { ...req, body }),
    del: <T>(path: string, req: HttpRequest = {}) => request<T>("DELETE", path, req),
    /** raw body 命令（tar 裸上传 / FormData 分片）+ raw response 逃生口（Blob 下载不过 decode）。 */
    async sendRaw<T>(path: string, body: BodyInit, contentType?: string, req: HttpRequest = {}): Promise<T> {
      const headers = { ...req.headers, ...(contentType ? { "Content-Type": contentType } : {}) };
      const raw = await runApi(
        requestJson(path, {
          method: "POST",
          headers,
          body,
          ...(req.signal ? { signal: req.signal } : {}),
        }),
      );
      return (req.decode ? req.decode(raw) : raw) as T;
    },
    /** 非 JSON 响应面（Blob 下载/文件预览）——完全绕过 decode。 */
    async getBlob(path: string, req: HttpRequest = {}): Promise<Blob> {
      const url = buildUrl(options.baseUrl, path, req.params);
      const response = await fetch(url, {
        headers: req.headers,
        ...(req.signal ? { signal: req.signal } : {}),
      });
      if (!response.ok) {
        const failure = toApiError(new HttpFailure({ status: response.status }));
        throw failure;
      }
      return response.blob();
    },
  };
}

export type Http = ReturnType<typeof createHttp>;
