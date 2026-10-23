import { describe, expect, it } from "vitest";
import type { ApiError } from "../src/kernel";
import { defineResource, isApiError, runCommand } from "../src/kernel";

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
    await expect(runCommand(apps.commands!.save, 1, {})).resolves.toEqual({
      status: "ok",
      payload: 2,
    });
  });
});
