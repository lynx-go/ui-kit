import { describe, expect, it } from "vitest";
import { encodeClientCursor } from "../src/kernel";
import { clientCollection, mockCollection, mockFetchAll } from "../src/adapters";
import { defineResource, isApiError } from "../src/kernel";

interface Row {
  id: string;
  name: string;
  status: string;
}

const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: `w${i + 1}`,
  name: `widget-${String(i + 1).padStart(2, "0")}`,
  status: i % 3 === 0 ? "running" : "stopped",
}));

describe("mockCollection 契约", () => {
  it("keyset 方言：空尾页停发 token、无 total", async () => {
    const mock = mockCollection(rows, { dialect: "keyset" });
    let cursor: string | undefined;
    let pages = 0;
    // size=10 → 3 页，第三页 rows=5 < size → 停发
    for (;;) {
      const seg = await mock.collection(
        { window: { size: 10, ...(cursor ? { cursor } : {}) } },
        {},
      );
      pages += 1;
      if (!seg.nextCursor) break;
      cursor = seg.nextCursor;
    }
    expect(pages).toBe(3);
    expect((await mock.collection({ window: { size: 10, cursor: encodeClientCursor(20) } }, {})).rows).toHaveLength(5);
  });

  it("offset 方言：附带 total（含过滤后）", async () => {
    const mock = mockCollection(rows, { dialect: "offset" });
    const seg = await mock.collection(
      { predicate: { field: "status", op: "eq", value: "running" }, window: { size: 3 } },
      {},
    );
    expect(seg.total).toBe(9);
    expect(seg.rows).toHaveLength(3);
  });

  it("failNext 注入失败（isApiError 可判别）；record 404 → not-found", async () => {
    const mock = mockCollection(rows);
    mock.handle.failNext({ kind: "server", status: 503, message: "boom" });
    await expect(mock.collection({ window: { size: 5 } }, {})).rejects.toSatisfy(isApiError);
    await expect(mock.record("nope", {})).rejects.toMatchObject({ kind: "not-found" });
    const seg = await mock.collection({ window: { size: 5 } }, {});
    expect(seg.rows).toHaveLength(5);
  });

  it("batch 按序返回且容忍缺号", async () => {
    const mock = mockCollection(rows);
    const out = await mock.batch(["w3", "missing", "w1"], {});
    expect(out.map((r) => r.id)).toEqual(["w3", "w1"]);
  });
});

describe("clientCollection + defineResource（整取方言端到端）", () => {
  const fetchAll = mockFetchAll(rows);
  const widgets = defineResource({
    name: "widgets",
    getId: (r: Row) => r.id,
    collection: clientCollection(fetchAll),
    record: (id) => Promise.resolve(rows.find((r) => r.id === id) ?? rows[0]!),
  });

  it("过滤 + 客户端翻页 + 伪造游标", async () => {
    const seg1 = await widgets.collection!(
      { predicate: { field: "status", op: "eq", value: "running" }, window: { size: 4 } },
      {},
    );
    expect(seg1.total).toBe(9);
    const seg2 = await widgets.collection!(
      {
        predicate: { field: "status", op: "eq", value: "running" },
        window: { size: 4, range: { offset: 8 } },
      },
      {},
    );
    expect(seg2.rows).toHaveLength(1);
  });

  it("fetchAll 失败注入穿透（四态 error 演示）", async () => {
    fetchAll.failNext({ kind: "network" });
    await expect(widgets.collection!({ window: { size: 4 } }, {})).rejects.toMatchObject({
      kind: "network",
    });
  });
});
