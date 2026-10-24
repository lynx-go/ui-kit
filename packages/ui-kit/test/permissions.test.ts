import { describe, expect, test } from "vitest";
import { type IdentityLike, permissionState } from "../src/react/permissions";
import { decodePreference } from "../src/react/preferences";

describe("permissionState（useCan 的纯推导）", () => {
  const identity = (
    status: IdentityLike<{ role: string }>["status"],
    data?: { role: string },
  ): IdentityLike<{ role: string }> => ({ status, data });

  test("loading → pending（未就绪 ≠ 拒绝，但同样不放行）", () => {
    expect(permissionState(identity("loading"), (me) => me.role === "admin")).toBe("pending");
  });

  test("error → denied（fail-closed）", () => {
    expect(permissionState(identity("error"), (me) => me.role === "admin")).toBe("denied");
  });

  test("success 由谓词裁决", () => {
    const isAdmin = (me: { role: string }) => me.role === "admin";
    expect(permissionState(identity("success", { role: "admin" }), isAdmin)).toBe("granted");
    expect(permissionState(identity("success", { role: "viewer" }), isAdmin)).toBe("denied");
  });

  test("success 但 data 缺席 → denied（不信任半载荷）", () => {
    expect(permissionState(identity("success"), () => true)).toBe("denied");
  });
});

describe("decodePreference（usePreference 的纯读）", () => {
  test("缺席 → fallback", () => {
    expect(decodePreference(null, { a: 1 })).toEqual({ a: 1 });
    expect(decodePreference(undefined, "x")).toBe("x");
  });

  test("JSON 缺省编解码 round-trip", () => {
    const raw = JSON.stringify([1, "two", false]);
    expect(decodePreference(raw, [])).toEqual([1, "two", false]);
  });

  test("坏载荷 → fallback（旧版本残留/手改不抛错）", () => {
    expect(decodePreference("{not json", { a: 1 })).toEqual({ a: 1 });
  });

  test("自定义 codec（布尔以 'on'/'off' 存储）", () => {
    const codec = {
      parse: (raw: string) => raw === "on",
      stringify: (value: boolean) => (value ? "on" : "off"),
    };
    expect(decodePreference("on", false, codec)).toBe(true);
    expect(decodePreference("off", true, codec)).toBe(false);
    expect(codec.stringify(true)).toBe("on");
  });
});
