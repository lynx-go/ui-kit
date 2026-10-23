import { describe, expect, it } from "vitest";
import { collectionQuerySchema } from "../src/schema";

const schema = collectionQuerySchema({
  text: ["name", "description"],
  filters: [{ field: "status", op: "eq" }],
  defaultSize: 8,
});

describe("collectionQuerySchema roundtrip", () => {
  it("empty params → defaults window", () => {
    const q = schema.decode({});
    expect(q.window.size).toBe(8);
    expect(q.window.cursor).toBeUndefined();
    expect(q.predicate).toBeUndefined();
  });

  it("encode → decode 往返（谓词/排序/游标）", () => {
    const q = schema.decode(
      schema.encode({
        predicate: { all: [{ field: "status", op: "eq", value: "running" }] },
        order: [{ field: "name", dir: "desc" }],
        window: { size: 8, cursor: "cab" },
      }),
    );
    // 单叶 all 规范化为叶（语义等价）
    expect(q.predicate).toEqual({ field: "status", op: "eq", value: "running" });
    expect(q.order).toEqual([{ field: "name", dir: "desc" }]);
    expect(q.window).toEqual({ size: 8, cursor: "cab" });
  });

  it("文本搜索解码为 any(contains) 谓词，再编码回 q", () => {
    const flat = schema.encode({
      predicate: { any: [{ field: "name", op: "contains", value: "web" }] },
      window: { size: 8 },
    });
    expect(flat.q).toBe("web");
    const q = schema.decode({ q: "web" });
    // q 展开到白名单全部字段（name + description）
    expect(q.predicate).toEqual({
      any: [
        { field: "name", op: "contains", value: "web" },
        { field: "description", op: "contains", value: "web" },
      ],
    });
  });

  it("page ↔ range.offset 往返", () => {
    const q = schema.decode({ page: 3, size: 8 });
    expect(q.window.range).toEqual({ offset: 16 });
    const flat = schema.encode(q);
    expect(flat.page).toBe(3);
    expect(flat.cursor).toBeUndefined();
  });

  it("容忍脏输入：坏 filter 条目被丢、NaN page 落默认、非法 sort 丢弃", () => {
    const q = schema.decode({
      filter: ["status:eq:running", "garbage", "a:bogus:v"],
      page: "NaN",
      sort: ["name:sideways", "createdAt:asc"],
    });
    expect(q.predicate).toEqual({ field: "status", op: "eq", value: "running" });
    expect(q.window.range).toBeUndefined();
    expect(q.order).toEqual([{ field: "createdAt", dir: "asc" }]);
  });

  it("in 算子的数组值往返", () => {
    const q = schema.decode(
      schema.encode({
        predicate: { field: "status", op: "in", value: ["running", "degraded"] },
        window: { size: 8 },
      }),
    );
    expect(q.predicate).toEqual({ field: "status", op: "in", value: ["running", "degraded"] });
  });
});

describe("collectionQuerySchema patch（写入契约：重置语义）", () => {
  it("谓词补丁清游标与页码", () => {
    const patch = schema.patch({ predicate: { field: "status", op: "eq", value: "stopped" } });
    expect(patch.filter).toEqual(["status:eq:stopped"]);
    expect(patch.cursor).toBeUndefined();
    expect(patch.page).toBeUndefined();
  });

  it("排序补丁清游标与页码（keyset 游标与方向耦合）", () => {
    const patch = schema.patch({ order: [{ field: "name", dir: "asc" }] });
    expect(patch.sort).toEqual(["name:asc"]);
    expect(patch.cursor).toBeUndefined();
    expect(patch.page).toBeUndefined();
  });

  it("窗口补丁：游标模式清页码，页码模式清游标", () => {
    expect(schema.patch({ window: { size: 8, cursor: "cxx" } })).toMatchObject({
      cursor: "cxx",
      page: undefined,
    });
    expect(schema.patch({ window: { size: 8, range: { offset: 8 } } })).toMatchObject({
      page: 2,
      cursor: undefined,
    });
  });
});

describe("collectionQuerySchema toSearchSchema", () => {
  it("validate 归一化且绝不 throw（validateSearch 幂等前提）", () => {
    const ss = schema.toSearchSchema();
    const once = ss["~standard"].validate({ filter: ["status:eq:running", "bad"], size: "16" });
    expect(once).toEqual({ value: { filter: ["status:eq:running"], size: 16 } });
    const twice = ss["~standard"].validate(once.value);
    expect(twice).toEqual(once); // 幂等
  });
});
