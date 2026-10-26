// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { collectionQuerySchema } from "../src/schema";
import { renderWithKit } from "../src/testing";

// 消费方自建 TestRouter/SearchProbe 样板的对位测试（§12.10-⑥）：
// schema 归一路径与真实 validateSearch 完全一致。

function Probe() {
  return <div data-testid="probe">ok</div>;
}

afterEach(cleanup);

describe("renderWithKit", () => {
  it("searchSchema 归一初始 search：已知键归一、filter 数组方言、schema 外键容忍透传", async () => {
    const schema = collectionQuerySchema({
      defaultSize: 20,
      filters: [{ field: "status" }],
      text: ["name"],
    });
    const r = await renderWithKit(<Probe />, {
      searchSchema: schema,
      search: { size: 50, filter: "status:eq:active", junk: "x" },
    });
    // TanStack validateSearch 合并方言：schema 外的键（消费方自定义参数）存活——与真实路由一致
    expect(r.getSearch()).toEqual({ size: 50, filter: ["status:eq:active"], junk: "x" });
  });

  it("无 schema 时 search 原样透传（消费方自定义参数族）", async () => {
    const r = await renderWithKit(<Probe />, { search: { tab: "1" } });
    expect(r.getSearch()).toEqual({ tab: "1" });
  });

  it("自定义 queryClient 透传（同键断言/失效观察的入口）", async () => {
    const schema = collectionQuerySchema();
    const r = await renderWithKit(<Probe />, { searchSchema: schema, search: {} });
    expect(r.queryClient.getDefaultOptions().queries?.retry).toBe(false);
  });
});
