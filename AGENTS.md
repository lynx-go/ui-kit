# AGENTS.md — @lynx-go/uikit 开发指南

> 面向在本仓库工作的 AI agent 与人类贡献者。设计依据见 [docs/design.md](docs/design.md)（draft-2，经六视角审查与交叉审核）。

## 仓库结构

```
packages/core   @lynx-go/uikit-core（npm）
  src/kernel    元概念契约+纯代数（零依赖、零 react）
  src/schema    CollectionQuery URL 编解码（实测零 effect import，分层允许；公开面零 effect/schema 泄漏）
  src/adapters  http 管线/订阅引擎（Effect 内部）/ndjson+sse transport/evaluate/clientCollection/mock/mockTransport
  src/react     绑定 hooks + queryOptions（禁 import effect，目录级 layer-check）
registry/       UI 块五族（values/query/command/subscription/shell），shadcn 拷贝制分发
apps/demo       活文档：每个配方一个可运行页面，mockResource 驱动
docs/           design.md / SKILL.md / llms.txt
```

## 分层不变量（`pnpm layer-check` 机械强制）

1. kernel 零运行时依赖、零 react import；
2. 依赖单向：kernel ← schema/adapters ← react ← blocks ← 消费方；
3. react 目录与 registry 禁 import effect（Effect 只住在 schema/adapters 缝里）；
4. 块不含业务实体名、不自带数据获取（只消费绑定输出）。

## 常用命令

```
pnpm check          # layer-check + typecheck + test + devtool 测试（提交前必绿）
pnpm --filter demo dev   # demo 起 5173
pnpm --filter demo e2e   # Playwright（URL 即真相的行为验收）
node scripts/registry-build.mjs
node scripts/devtool.mjs copy <family>/<name> --to <consumer-root> [--profile torchwood|fleetly] [--note "批次"]   # 拷贝制适配（§12.7）
```

## 关键约定（速查，完整版见 design.md §2/§13/§14）

- **名词预算 = 4**：Query / Command / Subscription / Resource。新增名词先证明不可推导。
- **命名政策**：契约=是什么 / 绑定=原语或其形（useCollection…）/ 适配器=动词 / 块=呈现什么。禁裸 `Query`、禁 `Event`（帧=Frame）、`QueryWindow`/`ResourceScope` 已避撞名。
- **URL 写入契约**：一切 setter 函数式 search；翻页=push、谓词/排序=replace+清游标；不在渲染期 navigate。
- **失败/结果两分**：ApiError 封闭集（throw）≠ CommandResult 结果分支（返回值）。
- 反模式清单与幻觉诱饵对照表见 design.md §13/§14（SKILL.md 直接引用）。

## 已知事项

- pnpm 12.9.1：workspace yaml 需含 `minimumReleaseAgeExclude` 段，否则首次 catalog 解析报误导性错误。
- DataTable 暂走 `@tanstack/react-table/legacy`（双 console 现行用法）；迁 v9 原生 features 是块内改动。
- Table v9 / router plugin 1.168 / effect ~4.0（tilde 锁，schema 模块 unstable）。
- demo 的 registry 块在 Tailwind v4 自动扫描根之外——`apps/demo/src/styles.css` 已声明 `@source "../../../registry"`（相对该文件三层到仓库根）；动 styles.css 位置时注意。
- effect v4 两个实测陷阱已内化为引擎裁决（design.md §5.3 实现期裁决）：Schedule 无 resettable（退避按帧归零用显式索引）；`Stream.runIntoQueue` 完成即以 Cause.Done 终结队列（连接侧用 `runForEach + Queue.offer`）。
