import { describe, expect, it } from "vitest";
import type { Predicate } from "../src/kernel";
import { textPredicate } from "../src/kernel";
import { eqFilter, filterLeaves, filterValues, predicateOf } from "../src/schema";

describe("谓词纯函数层（§12.10-④）", () => {
  const p = (predicate: Predicate | null) => predicate;

  it("filterLeaves：AND 树展开为叶子清单；null/undefined 归空", () => {
    const tree: Predicate = {
      all: [
        { field: "status", op: "eq", value: "active" },
        { all: [{ field: "kind", op: "eq", value: "web" }] },
      ],
    };
    expect(filterLeaves(tree)).toEqual([
      { field: "status", op: "eq", value: "active" },
      { field: "kind", op: "eq", value: "web" },
    ]);
    expect(filterLeaves(null)).toEqual([]);
    expect(filterLeaves(undefined)).toEqual([]);
  });

  it("filterLeaves：文本搜索的 any 形（textPredicate 产物）宽容展开", () => {
    const text = textPredicate(["name", "id"], "web-1");
    expect(text).not.toBeNull();
    const leaves = filterLeaves(text);
    expect(leaves.length).toBe(2);
    expect(leaves.every((l) => l.op === "contains")).toBe(true);
  });

  it("filterValues：field → 单值（后叶覆盖）；数组值（in）不入单值投影", () => {
    const tree: Predicate = {
      all: [
        { field: "enabled", op: "eq", value: "true" },
        { field: "env", op: "eq", value: "prod" },
        { field: "env", op: "eq", value: "staging" },
        { field: "ids", op: "in", value: ["a", "b"] },
      ],
    };
    expect(filterValues(tree)).toEqual({ enabled: "true", env: "staging" });
  });

  it("predicateOf：0→null、1→裸叶、n→AND（取代手写三元归一化）", () => {
    expect(predicateOf([])).toBeNull();
    const leaf = eqFilter("status", "active");
    expect(predicateOf([leaf])).toBe(leaf);
    expect(predicateOf([leaf, eqFilter("env", "prod")])).toEqual({
      all: [leaf, { field: "env", op: "eq", value: "prod" }],
    });
    expect(p(predicateOf([leaf]))).not.toBeNull();
  });

  it("filterValues ∘ predicateOf 与 codec 的 URL 往返一致（q + filter 混合树）", () => {
    // torchwood 过滤 UI 的完整读写环：读 = filterValues，写 = predicateOf
    const leaves = [eqFilter("action", "create"), eqFilter("status", "ok")];
    const round = filterValues(p(predicateOf(leaves))!);
    expect(round).toEqual({ action: "create", status: "ok" });
  });
});

describe("scopeReady（§12.10-③）", () => {
  it("未声明 scope 键的资源恒就绪", async () => {
    const { scopeReady } = await import("../src/react/scope");
    expect(scopeReady({}, undefined)).toBe(true);
    expect(scopeReady({ scope: [] }, {})).toBe(true);
  });

  it("声明的键缺值 = 未就绪（undefined/null 皆缺）", async () => {
    const { scopeReady } = await import("../src/react/scope");
    expect(scopeReady({ scope: ["projectId"] }, { projectId: "p1" })).toBe(true);
    expect(scopeReady({ scope: ["projectId"] }, { projectId: undefined })).toBe(false);
    expect(scopeReady({ scope: ["projectId"] }, undefined)).toBe(false);
    expect(scopeReady({ scope: ["projectId", "orgId"] }, { projectId: "p1" })).toBe(false);
  });
});
