import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { ApiError, ResourceScope } from "../src/kernel";
import { defineResource, isApiError, runCommand } from "../src/kernel";
import { invalidateAfterCommand } from "../src/react/command";

const ok = <P>(payload: P) => ({ status: "ok" as const, payload });

describe("runCommand（treatAs 裁决与失败/结果两分）", () => {
  it("ok 结果透传", async () => {
    const descriptor = { run: async (n: number) => ok(n * 2) };
    await expect(runCommand(descriptor, 21, {})).resolves.toEqual({ status: "ok", payload: 42 });
  });

  it("not-found 失败经 treatAs 覆写为幂等 ok；未覆写则原样出界", async () => {
    const notFound: ApiError = { kind: "not-found" };
    const withTreatAs = {
      run: async (_: string) => {
        throw notFound;
      },
      treatAs: { "not-found": ok(null) },
    };
    await expect(runCommand(withTreatAs, "gone", {})).resolves.toEqual({
      status: "ok",
      payload: null,
    });

    const withoutTreatAs = {
      run: async (_: string) => {
        throw notFound;
      },
    };
    await expect(runCommand(withoutTreatAs, "gone", {})).rejects.toSatisfy(isApiError);
  });

  it("网络失败不参与 treatAs——原样出界（失败通道）", async () => {
    const descriptor = {
      run: async (_: string) => {
        throw { kind: "network" } satisfies ApiError;
      },
      treatAs: { "not-found": ok(null) },
    };
    await expect(runCommand(descriptor, "x", {})).rejects.toMatchObject({ kind: "network" });
  });
});

describe("defineResource 命令接线（默认失效的归属注入）", () => {
  it("命令描述符携带 __resource（缺省 invalidates 的失效目标）", () => {
    const apps = defineResource({
      name: "apps",
      commands: {
        save: { run: async () => ok(1) },
      },
    });
    expect(apps.commands?.save.__resource).toBe(apps.name);
  });

  it("runCommand 与资源命令直通（命令式编排消费同一路径）", async () => {
    const apps = defineResource({
      name: "apps",
      commands: {
        save: { run: async (n: number) => ok(n + 1) },
      },
    });
    await expect(runCommand(apps.commands.save, 1, {})).resolves.toEqual({
      status: "ok",
      payload: 2,
    });
  });
});

describe("legacyKeys 存量键失效桥（§12.10-②）", () => {
  it("资源级 legacyKeys 注入为各命令缺省；descriptor 自带优先", () => {
    const apps = defineResource({
      name: "apps",
      legacyKeys: (scope) => [["apps", scope.projectId]],
      commands: {
        save: { run: async () => ok(1) },
        purge: {
          run: async () => ok(null),
          legacyKeys: (_scope: ResourceScope) => [["apps-purge"]],
        },
      },
    });
    expect(apps.commands.save.legacyKeys?.({ projectId: "p1" })).toEqual([["apps", "p1"]]);
    expect(apps.commands.purge.legacyKeys?.({ projectId: "p1" })).toEqual([["apps-purge"]]);
  });

  it("invalidateAfterCommand：kit 键 selector 匹配 + legacyKeys 前缀并行失效", async () => {
    const client = new QueryClient();
    const groups = defineResource({
      name: "groups",
      legacyKeys: (scope) => [
        ["groups", scope.projectId],
        ["memberships", "g-1"],
      ],
      commands: { save: { run: async () => ok(null) } },
    });
    // fleet 键（同资源、同 scope）+ 存量键 + 他 scope 存量键
    client.setQueryData(["collection", "groups", { projectId: "p1" }, null, null, { size: 20 }], []);
    client.setQueryData(["groups", "p1"], []);
    client.setQueryData(["memberships", "g-1"], []);
    client.setQueryData(["groups", "p2"], []);
    client.setQueryData(["others"], []);

    await invalidateAfterCommand(client, groups.commands.save, { projectId: "p1" });

    expect(client.getQueryState(["collection", "groups", { projectId: "p1" }, null, null, { size: 20 }])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["groups", "p1"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["memberships", "g-1"])?.isInvalidated).toBe(true);
    // scope 相交（kit 键）与闭包精确键（legacy）之外的键不受影响
    expect(client.getQueryState(["groups", "p2"])?.isInvalidated).toBe(false);
    expect(client.getQueryState(["others"])?.isInvalidated).toBe(false);
  });

  it("invalidateAfterCommand：他 scope 的 kit 键不被默认失效（scope 相交）", async () => {
    const client = new QueryClient();
    const groups = defineResource({
      name: "groups",
      commands: { save: { run: async () => ok(null) } },
    });
    client.setQueryData(["collection", "groups", { projectId: "p2" }, null, null, { size: 20 }], []);
    await invalidateAfterCommand(client, groups.commands.save, { projectId: "p1" });
    expect(
      client.getQueryState(["collection", "groups", { projectId: "p2" }, null, null, { size: 20 }])
        ?.isInvalidated,
    ).toBe(false);
  });
});

describe("defineResource commands 类型收窄（§12.10-⑥）", () => {
  it("commands 在 spec 上出现时返回类型非可选（消费方免 commands!）", () => {
    const apps = defineResource({
      name: "apps",
      commands: {
        save: { run: async (n: number) => ok(n) },
      },
    });
    // 无 ?. / 无 !：类型收窄的编译期证明（tsc 即断言）
    expect(apps.commands.save.__resource).toBe(apps.name);
    expect(apps.commands.save.run).toBeTypeOf("function");
  });

  it("无 commands 的资源保持可选形态（commands 仍可 ?.）", () => {
    const streams = defineResource({ name: "streams" });
    expect(streams.commands).toBeUndefined();
  });
});
