import { mockCollection, mockTransport } from "@fleetly/fleet-ui-kit/adapters";
import type { CommandResult } from "@fleetly/fleet-ui-kit/kernel";
import { defineResource } from "@fleetly/fleet-ui-kit/kernel";

/**
 * quickstart 向导链的 mock 数据源（fleetly 实证语义：ensure 幂等——同名复用不重造；
 * 链尾是 wait 流到终态而非轮询）。命令挂在资源上（defineResource 注入 __resource
 * → 缺省失效同资源全部查询）。
 */

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Workload {
  id: string;
  name: string;
  projectId: string;
  replicas: number;
  createdAt: string;
}

const projectsMock = mockCollection<Project>([], { dialect: "offset", latencyMs: 100 });
const workloadsMock = mockCollection<Workload>([], { dialect: "offset", latencyMs: 100 });

export const projectsResource = defineResource({
  name: "projects",
  getId: (row) => row.id,
  collection: projectsMock.collection,
  commands: {
    /** ensure 语义（quickstart 实证：reused if it already exists） */
    ensure: {
      run: (input: { name: string }) => {
        const existing = projectsMock.handle.rows().find((p) => p.name === input.name);
        if (existing)
          return Promise.resolve({
            status: "ok",
            payload: existing,
          } satisfies CommandResult<Project>);
        const project: Project = {
          id: `prj-${Date.now().toString(36)}`,
          name: input.name,
          createdAt: new Date().toISOString(),
        };
        projectsMock.handle.replaceRows([project, ...projectsMock.handle.rows()]);
        return Promise.resolve({ status: "ok", payload: project } satisfies CommandResult<Project>);
      },
    },
  },
});

export const workloadsResource = defineResource({
  name: "workloads",
  getId: (row) => row.id,
  collection: workloadsMock.collection,
  commands: {
    create: {
      run: (input: { name: string; projectId: string; replicas: number }) => {
        const workload: Workload = {
          id: `wld-${Date.now().toString(36)}`,
          createdAt: new Date().toISOString(),
          ...input,
          replicas: Number(input.replicas),
        };
        workloadsMock.handle.replaceRows([workload, ...workloadsMock.handle.rows()]);
        return Promise.resolve({
          status: "ok",
          payload: workload,
        } satisfies CommandResult<Workload>);
      },
    },
  },
});

// ============ wait 流（部署等待步骤：帧到终态收流） ============

export interface WaitFrame {
  state: "provisioning" | "healthy" | "failed";
  at: string;
  detail?: string;
}

/** 一次运行的脚本：provisioning 帧递进 → healthy → 正常收流（closeReason "ended"） */
export function createWaitRun(transport: { emit(frame: WaitFrame): void; end(): void }) {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let runId = 0;
  return {
    run(): void {
      runId += 1;
      const id = runId;
      for (const timer of timers) clearTimeout(timer);
      timers = [];
      const stages: ReadonlyArray<{ afterMs: number; frame: WaitFrame }> = [
        {
          afterMs: 150,
          frame: {
            state: "provisioning",
            at: new Date().toISOString(),
            detail: "scheduling replicas",
          },
        },
        {
          afterMs: 1000,
          frame: { state: "provisioning", at: new Date().toISOString(), detail: "pulling image" },
        },
        {
          afterMs: 1900,
          frame: { state: "provisioning", at: new Date().toISOString(), detail: "rolling out 2/3" },
        },
        {
          afterMs: 2800,
          frame: { state: "healthy", at: new Date().toISOString(), detail: "probes passing" },
        },
      ];
      for (const stage of stages) {
        timers.push(
          setTimeout(() => {
            if (id === runId) transport.emit(stage.frame);
          }, stage.afterMs),
        );
      }
      timers.push(
        setTimeout(() => {
          if (id === runId) transport.end();
        }, 3200),
      );
    },
    stop(): void {
      runId += 1;
      for (const timer of timers) clearTimeout(timer);
      timers = [];
    },
  };
}

/** 每次向导运行新建（状态机每代独立——重开向导不接旧流） */
export function createWaitTransport() {
  return mockTransport<WaitFrame>();
}
