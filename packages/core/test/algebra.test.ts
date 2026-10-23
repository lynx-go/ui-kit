import { describe, expect, it } from "vitest";
import {
  advance,
  decodeClientCursor,
  encodeClientCursor,
  evaluateQuery,
  textPredicate,
} from "../src/kernel";

const rows = [
  { id: "1", name: "alpha", status: "running", score: 3 },
  { id: "2", name: "bravo", status: "stopped", score: 1 },
  { id: "3", name: "charlie", status: "running", score: 2 },
  { id: "4", name: "delta", status: "degraded", score: 5 },
  { id: "5", name: "echo", status: "running", score: 4 },
];

describe("evaluateQuery（客户端求值）", () => {
  it("过滤 + 排序 + range 切片，附 total", () => {
    const seg = evaluateQuery(
      {
        predicate: { field: "status", op: "eq", value: "running" },
        order: [{ field: "score", dir: "desc" }],
        window: { size: 2, range: { offset: 0 } },
      },
      rows,
    );
    expect(seg.rows.map((r) => r.id)).toEqual(["5", "1"]);
    expect(seg.total).toBe(3);
  });

  it("游标模式：伪造 token 往返且空尾页停发 nextCursor", () => {
    const first = evaluateQuery(
      { order: [{ field: "id", dir: "asc" }], window: { size: 2, cursor: encodeClientCursor(0) } },
      rows,
    );
    expect(first.rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(first.nextCursor).toBeDefined();
    const second = evaluateQuery(
      {
        order: [{ field: "id", dir: "asc" }],
        window: { size: 2, cursor: first.nextCursor! },
      },
      rows,
    );
    expect(second.rows.map((r) => r.id)).toEqual(["3", "4"]);
    const third = evaluateQuery(
      {
        order: [{ field: "id", dir: "asc" }],
        window: { size: 2, cursor: second.nextCursor! },
      },
      rows,
    );
    expect(third.rows.map((r) => r.id)).toEqual(["5"]);
    expect(third.nextCursor).toBeUndefined();
  });

  it("textPredicate 生成 any(contains)", () => {
    const pred = textPredicate(["name"], "ALP");
    expect(evaluateQuery({ predicate: pred, window: { size: 10 } }, rows).rows.map((r) => r.id)).toEqual([
      "1",
    ]);
  });
});

describe("advance（游标代数）", () => {
  it("range 方言 next/prev 可本地算", () => {
    const w = { size: 2, range: { offset: 0 } };
    const next = advance(w, { rows: [], total: 5 }, "next")!;
    expect(next.range).toEqual({ offset: 2 });
    const prev = advance(next, { rows: [], total: 5 }, "prev")!;
    expect(prev.range).toEqual({ offset: 0 });
    expect(advance(w, { rows: [], total: 5 }, "prev")).toBeNull();
  });

  it("total 边界：next 越过 total 返回 null", () => {
    expect(advance({ size: 2, range: { offset: 4 } }, { rows: [], total: 5 }, "next")).toBeNull();
  });

  it("客户端伪造游标 prev 可算；服务端不透明游标 prev 不可算（走浏览器历史）", () => {
    const clientPrev = advance(
      { size: 2, cursor: encodeClientCursor(4) },
      { rows: [], total: undefined },
      "prev",
    );
    expect(decodeClientCursor(clientPrev!.cursor!)).toBe(2);
    expect(advance({ size: 2, cursor: "opaque-server-token" }, { rows: [] }, "prev")).toBeNull();
  });

  it("keyset next 依赖 segment.nextCursor（空页停发 → null）", () => {
    expect(advance({ size: 2, cursor: "c2" }, { rows: [], nextCursor: "c4" }, "next")!.cursor).toBe("c4");
    expect(advance({ size: 2, cursor: "c4" }, { rows: [] }, "next")).toBeNull();
  });
});
