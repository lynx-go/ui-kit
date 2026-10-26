# @lynx-go/uikit

数据密集 console UI 的无头核心 + 拷贝制 UI 块——架在 TanStack 引擎上的 **Query / Command / Subscription**。

[English](README.md)

## 是什么

一个 console 页面 = 三个交互原语 + 一个交互面，且都不需要重造引擎：

| 名词 | 角色 | 你得到什么 |
| --- | --- | --- |
| **Query** | 看 | 过滤/分页集合，窗口状态住在 URL 里 |
| **Command** | 做 | 具名动词返回 `CommandResult` 结果分支 + 声明式缓存失效 |
| **Subscription** | 听 | 按游标定位的**帧**递送——backlog → follow、断档重同步、退避转轮询 |
| **Resource** | 交互面 | 另外三者挂靠的名词；一个 `defineResource` 接通查询、命令与 scope |

设计原则是机械强制的，不是口号：

- **TanStack 原生。** Router（typed routes + `validateSearch`）、Query、Table、Form 就是引擎层。uikit 只做绑定，不在引擎上再包一层。
- **URL 即真相。** 一切查询窗口都是 URL 状态。setter 全部函数式：翻页 push（历史栈就是分页栈）、谓词/排序 replace 并清游标。
- **失败 ≠ 结果。** `ApiError` 是封闭集，在 transport 缝上 throw；`CommandResult` 以值分支（`ok` / `rejected` / `conflict`）返回——预期内结果绝不走异常通道。
- **帧，不是事件。** 订阅递送携带游标的位置化帧——可续读、可重排进缓冲、可降级轮询——不是不透明的 pub/sub 回调。
- **Effect 只住在缝里。** kernel 是零依赖、零 React 的纯代数；Effect-TS 被限制在 schema/adapters 层，`react/` 与 registry 块连 import 都做不到（`pnpm layer-check` 强制）。

## 包与分发

两个通道，刻意不同：

- **`@lynx-go/uikit-core`**（`packages/core`）——无头核心：kernel 契约 + URL 编解码 + HTTP 管线/订阅引擎 + React 绑定 + 测试 harness。发 npm，源码分发。
- **`registry/`**——五族 UI 块，shadcn 式：**拷贝**进你的仓，代码归你所有。块不含业务实体、不自带数据获取，只消费绑定输出。

```bash
npm install @lynx-go/uikit-core
# peers: react >=19 · @tanstack/react-query >=5.100 · @tanstack/react-router >=1.120（可选）· @tanstack/react-form >=1.30（可选）
```

## 快速上手

声明一个 Resource，路由与绑定共享同一个 search schema，读集合：

```tsx
// lib/projects.ts
import { mockCollection } from "@lynx-go/uikit-core/adapters";
import { defineResource } from "@lynx-go/uikit-core/kernel";
import { collectionQuerySchema } from "@lynx-go/uikit-core/schema";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

const mock = mockCollection<Project>(
  [
    { id: "p1", name: "edge-1", createdAt: "2026-01-04T09:00:00Z" },
    { id: "p2", name: "edge-2", createdAt: "2026-01-11T09:00:00Z" },
  ],
  { dialect: "offset", latencyMs: 80 },
);

export const projectsResource = defineResource({
  name: "projects",
  getId: (row) => row.id,
  collection: mock.collection,
  commands: {
    rename: {
      run: async (input: { id: string; name: string }) => {
        const rows = mock.handle.rows();
        const row = rows.find((p) => p.id === input.id);
        if (!row) return { status: "rejected", message: "project not found" };
        mock.handle.replaceRows(
          rows.map((p) => (p.id === input.id ? { ...p, name: input.name } : p)),
        );
        return { status: "ok", payload: { ...row, name: input.name } };
      },
    },
  },
});

// 查询窗口状态住在 URL 里——路由与绑定共享同一 schema 实例。
export const projectsSearch = collectionQuerySchema({ defaultSize: 20 });
```

```tsx
// routes/projects.index.tsx —— TanStack Router 文件路由
import { useCollection } from "@lynx-go/uikit-core";
import { createFileRoute } from "@tanstack/react-router";
import { projectsResource, projectsSearch } from "@/lib/projects";

export const Route = createFileRoute("/projects/")({
  validateSearch: projectsSearch.toSearchSchema(),
  component: ProjectsPage,
});

function ProjectsPage() {
  // 窗口（页码/过滤/排序）来自 URL；setter 全部函数式。
  const list = useCollection(projectsResource, { from: Route.id, search: projectsSearch });

  if (list.status === "loading") return <p>Loading…</p>;

  return (
    <ul>
      {list.rows.map((project) => (
        <li key={project.id}>{project.name}</li>
      ))}
    </ul>
  );
}
```

命令是同一套故事：结果走值分支，缺省失效（同资源全部查询 settle 后重取）：

```tsx
const form = useCommandForm(projectsResource.commands.rename, {
  defaultValues: { name: "" },
  onSettled: (result) => {
    if (result?.status === "ok") closeDialog();
    // "rejected" 携带 message + fieldErrors——渲染它们，而不是 catch 它们
  },
});
```

订阅递送可续读、可缓冲、可降级轮询的位置化帧：

```tsx
const sub = useSubscription(eventsStream, {
  cursor,                        // 从你上次停下的地方精确续读
  getCursor: (frame) => frame.seq,
  onFrame: appendLiveEvent,
});
```

接真实后端时把 `mockCollection` 换成 `clientCollection`（HTTP 管线，offset/keyset 双方言，NDJSON/SSE transport）——绑定层一行不改。

## UI 块：拷贝，不依赖

块不是 npm 依赖；它经 token 方言适配拷进你的仓，从此归你所有：

```bash
node scripts/devtool.mjs copy query/list-page --to ../your-console --profile your-profile
node scripts/devtool.mjs diff --all --dir src/components/kit --check   # 升级后的漂移门禁
```

| 族 | 呈现 | 示例 |
| --- | --- | --- |
| `values` | 一个值 | `status-badge`、`relative-time`、`stat-card`、`metric-chart`、`states` |
| `query` | 一个集合 | `list-page`、`data-table`、`filter-bar`、`pagination`、`keyset-pagination`、`detail-page` |
| `command` | 一个动词 | `form`、`fields`、`delete-button`、`confirm-dialog` |
| `subscription` | 一条流 | `event-feed`、`log-viewer`、`stage-timeline` |
| `shell` | 页面 | `app-shell`、`page`、`stepper`、`scope-switcher`、`route-error-boundary` |

`registry/registry.json` 兼容 shadcn CLI；devtool 在其上补消费方 token 方言 profile 与 vendored 头，让后续升级可机械 diff。

## 仓库结构

```
packages/core   @lynx-go/uikit-core  kernel / schema / adapters / react / testing
registry/       UI 块五族（拷贝制分发）
apps/demo       活文档——每个配方一个可运行页面
docs/           design.md（决策与历史）· SKILL.md（页面作者册）· llms.txt
scripts/        layer-check · registry-build · devtool（copy/diff）· size-check
```

分层是被强制的，不是被鼓励的：kernel 零运行时依赖、零 React import；依赖单向流动；`react/` 与 `registry/` 无法 import Effect。

## 文档

- [docs/design.md](docs/design.md)——完整设计文档：每条决策带证据，附带日期的批次变更史。
- [docs/SKILL.md](docs/SKILL.md)——页面作者册，面向写 console 页面的 AI agent 与人类。
- [apps/demo](apps/demo)——可运行配方：列表/详情页、向导、scoped 资源、流、失败态。
- [docs/llms.txt](docs/llms.txt)——机器侧索引。

## 状态

Pre-1.0（`0.3.x`），驱动内部生产 console。minor 之间可能有破坏性变更；全部以带日期的批次记录在 [docs/design.md](docs/design.md)。

## 许可

MIT
