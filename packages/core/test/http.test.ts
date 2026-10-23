import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttp } from "../src/adapters";
import { isApiError } from "../src/kernel";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubFetch(status: number, body?: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("createHttp（缝 1：错误通道）", () => {
  it("200 → JSON 直通；decode 钩子可用", async () => {
    stubFetch(200, { apps: [{ id: "a1" }] });
    const http = createHttp();
    const out = await http.get<{ apps: Array<{ id: string }> }>("/v1/apps", {
      decode: (raw) => raw as { apps: Array<{ id: string }> },
    });
    expect(out.apps[0]!.id).toBe("a1");
  });

  it("401 → onUnauthorized 先行，出界为 ApiError.auth", async () => {
    stubFetch(401, { code: "UNAUTHENTICATED", message: "session expired" });
    const onUnauthorized = vi.fn();
    const http = createHttp({ onUnauthorized });
    await expect(http.get("/v1/apps")).rejects.toSatisfy((e) => isApiError(e) && e.kind === "auth");
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("404 → not-found；403 → forbidden；5xx → server（附信封 message）", async () => {
    stubFetch(404, {});
    await expect(createHttp().get("/x")).rejects.toMatchObject({ kind: "not-found" });
    stubFetch(403, {});
    await expect(createHttp().get("/x")).rejects.toMatchObject({ kind: "forbidden" });
    stubFetch(503, { message: "boom" });
    await expect(createHttp().get("/x")).rejects.toMatchObject({
      kind: "server",
      status: 503,
      message: "boom",
    });
  });

  it("网络断层 → network（typed failure，非 defect）", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;
    await expect(createHttp().get("/x")).rejects.toSatisfy(
      (e) => isApiError(e) && e.kind === "network",
    );
  });

  it("repeated 参数序列化为 key=a&key=b（gateway 方言）", async () => {
    const fn = stubFetch(200, {});
    const http = createHttp();
    await http.get("/v1/users", { params: { queries: ["a", "b"], page: 2 } });
    const url = (fn.mock.calls[0]![0] as string).toString();
    expect(url).toContain("queries=a&queries=b");
    expect(url).toContain("page=2");
  });

  it("sendRaw 裸体上传（tar）", async () => {
    const fn = stubFetch(200, { deduplicated: true });
    const http = createHttp();
    await http.sendRaw("/v1/uploads", new Blob(["x"]), "application/x-tar");
    const init = fn.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-tar");
  });
});
