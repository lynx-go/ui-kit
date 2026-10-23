import { describe, expect, it } from "vitest";
import {
  batchKey,
  collectionKey,
  defineResource,
  invalidationPredicate,
  recordKey,
  scoped,
  selectorMatches,
} from "../src/kernel";
import { clientCollection } from "../src/adapters";

const apps = defineResource({
  name: "apps",
  getId: (r: { id: string }) => r.id,
  collection: clientCollection(async () => []),
});

describe("查询键", () => {
  it("键形为 [kind, name, scope, ...detail]", () => {
    const key = collectionKey(apps, { window: { size: 20 } });
    expect(key[0]).toBe("collection");
    expect(key[1]).toBe("apps");
  });

  it("scoped 嵌入 scope 段（canonical 排序）", () => {
    const key = collectionKey(scoped(apps, { projectId: "p1", env: undefined }), {
      window: { size: 20 },
    });
    expect(key[2]).toEqual({ projectId: "p1" });
    expect(recordKey(scoped(apps, { projectId: "p1" }), "a1")[3]).toBe("a1");
    expect(batchKey(apps, ["b", "a", "b"])[3]).toEqual(["b", "a"]); // 去重保序
  });
});

describe("失效矩阵（selector 匹配 + scope 交运算）", () => {
  const appsA = scoped(apps, { projectId: "A" });
  const appsB = scoped(apps, { projectId: "B" });

  const key = (resource: typeof apps, id?: string) =>
    id === undefined
      ? collectionKey(resource, { window: { size: 20 } })
      : recordKey(resource, id);

  it("同资源同 scope 命中；跨 scope 默认不命中（交运算）", () => {
    expect(selectorMatches({ resource: "apps" }, key(appsA), { projectId: "A" })).toBe(true);
    expect(selectorMatches({ resource: "apps" }, key(appsB), { projectId: "A" })).toBe(false);
  });

  it("allScopes 显式逃逸", () => {
    expect(
      selectorMatches({ resource: "apps", allScopes: true }, key(appsB), { projectId: "A" }),
    ).toBe(true);
  });

  it("kind 与 record id 过滤；batch 键被 batch selector 覆盖", () => {
    expect(
      selectorMatches({ resource: "apps", kind: "collection" }, recordKey(appsA, "x"), {}),
    ).toBe(false);
    expect(
      selectorMatches(
        { resource: "apps", kind: "record", id: "x" },
        recordKey(appsA, "x"),
        { projectId: "A" },
      ),
    ).toBe(true);
    expect(selectorMatches({ resource: "apps" }, batchKey(appsA, ["x"]), { projectId: "A" })).toBe(
      true,
    );
  });

  it("invalidationPredicate 过滤非 fleet 键", () => {
    const pred = invalidationPredicate([{ resource: "apps" }], {});
    expect(pred({ queryKey: ["collection", "apps", {}, null, null, {}] })).toBe(true);
    expect(pred({ queryKey: ["users"] })).toBe(false);
  });
});
