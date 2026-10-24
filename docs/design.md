# fleet-ui 设计文档

- **版本**：draft-2（六视角审查 + 交叉审核修订版）
- **日期**：2026-10-23
- **状态**：阶段 A3 产物。已经过六个独立视角只读审查（概念审计 / React·TanStack DX / 双 Console 可实现性 / 竞品对标 / Agent 可用性 / Effect 集成），约 130 条发现经主会话逐条裁决，13 条 P0 全部采纳修订。裁决记录见附录 C。
- **上游输入**：`~/workspace/qiulin/ui-components` 全仓尸检；refine / react-admin / TanStack / shadcn / Effect v4 生态调研；fleetly console 与 torchwood console 全量盘点；十轮设计迭代与四项概念审计修复。
- **待办**：A4——用户评审本文档，通过后进入阶段 B（monorepo 骨架）/ C（垂直切片）。

---

## 0. 定位与非目标

**fleet-ui** 是一个数据密集 console UI 库：由人指导 AI Agent 构建，同样服务于人指导 AI Agent 的使用。

**定位**：
1. **内部优先、开源友好**——首要消费者是 fleetly console 与 torchwood console 的重写；但无业务残留：英文命名、文案全走 messages 覆盖通道、不含任何业务名词。
2. **TanStack 原生**——Router（typed file routes + `validateSearch`）、Query、Table、Form 是引擎层，**借用不重建**。fleet-ui 不在引擎上再包一层抽象（refine 的 routerProvider 两次重写是前车之鉴）。
3. **分发双通道**——无头核心 `@fleetly/fleet-ui-kit` 发 npm（semver + changesets）；UI 块走 shadcn registry 拷贝制（open code，归消费方所有）。
4. **Agent-first**——SKILL.md（TanStack Intent 格式）、llms.txt、AGENTS.md 随包分发；集中反模式清单（§13）与幻觉诱饵对照表（§14）直接进 SKILL.md。

**非目标（持证拒签，理由与重启条件见 §8）**：
- 不造路由抽象层（不支持多路由器/SSR 元框架绑定）
- 不做页面原型 / 词表 / 登记制本体论（旧项目死因）
- 不做 undo / 乐观更新（双 console 零使用证伪；**明码标价**：react-admin 与 shadcn-admin-kit 的编辑/删除默认即 undoable，fleet-ui 默认同步等待——这是有意的体验取舍）
- 不做后端适配器生态（自持后端，适配缝即插件点）
- 不做完整 i18n 语言包（messages 通道 + 消费方词条）
- 不内置 toast/通知系统（`useCommandForm` 暴露 `onSettled` 回调，消费方接 sonner 等——shadcn 生态惯例）

**一句话**：fleet-ui = 三个交互原语（Query / Command / Subscription）+ 一个交互面（Resource）+ Effect 缝隙 + 五族 UI 块，架在 TanStack 引擎上。

---

## 1. 第一性推导：交互类型学

### 1.1 状态空间

数据密集 console UI 的本质状态空间 = **数据 × 意图 × 时间**。把两个真实 console（fleetly / torchwood，合计约 100 条路由）的全部页面拆到底，对后端做的事穷尽为三种**消息**：

| 原语             | 中文 | 语义                           | 引擎落点                                        |
| ---------------- | ---- | ------------------------------ | ----------------------------------------------- |
| **Query**        | 问   | 参数化缓存读，无副作用         | TanStack Query                                  |
| **Command**      | 令   | 有副作用的意图，可被结构化拒绝 | TanStack Query mutation + 失效                  |
| **Subscription** | 听   | 按游标定位的帧递送             | fleet-ui 自建（Effect 引擎在 /adapters，见 §5） |

三者同属一个语域（交互消息类型学，CQRS + 订阅的标准词汇），彼此正交（§2 各节论证）。

### 1.2 引擎借用

缓存/去重/失效（Query）、URL/类型化路由/历史栈（Router）、表格状态机（Table）、表单状态机（Form）已经由 TanStack 提供。fleet-ui 的价值不在重建引擎，而在：
1. 定义**用户实现的契约**（后端交互的统一形状）；
2. 提供**绑定**（把契约接到引擎与 URL 的 headless hooks + queryOptions 预取工厂）；
3. 提供**块**（消费绑定输出的 shadcn 风格组件）。

### 1.3 为什么不是别的切法（负空间记录）

- **按数据形状切**（Record/Collection/Sequence）：错误通道、422→表单映射、缓冲重连这些真实接缝都是**交互形状**的而非数据形状的——接缝长在哪儿，概念就该切在哪儿。
- **View 作为元概念**：View 是 `collection()` 的输入类型，离了 Query 无意义——"函数的参数表"不是与"函数"并列的原语（范畴错误，第 7 轮迭代修正）。
- **Source 打包读+写**：名字只覆盖读（"来源"不接受命令），且把两种正交原语焊在一个只适合其中一个的名字下。

### 1.4 分层与自洽性检验

```
kernel（元概念：契约+类型+纯代数，零依赖，零 react import）
   ↑                ↑
schema            adapters
（Effect Schema     （http 管线(Effect 内部)、evaluateQuery/clientCollection、
 工厂；公开面零      订阅引擎(Stream/Queue/Schedule 管线，零 React)、
 effect/schema      transport、scoped、mock）
 泄漏）
   ↑                ↑
   └────┬───────────┘
      react（绑定 hooks：useSyncExternalStore 接线 + queryOptions；peer: TanStack 系；
            目录级禁 import effect）
        ↑
     blocks（registry 五族）
        ↑
   消费方 app（features/ 业务组件）
```

**机械可查的不变量**（layer-check，目录级 import 禁令 + 声明扫描）：
1. kernel 零运行时依赖、零 react import；
2. 依赖严格单向向上；
3. **react 目录零 effect import**（订阅引擎已挪 /adapters，此规则从签名级检查退化为更强更便宜的目录级禁令）；
4. /schema 公开 API 零 `effect/schema` 类型泄漏（只出纯函数 + Standard Schema 包装——对 effect v4 中 schema 模块 unstable 身份的防线，升格为不变量）；
5. 块不含业务实体名、不自带数据获取语义（只消费绑定输出）。

**名词预算**：领域元名词 = 4（Query / Command / Subscription / Resource）。新增名词必须先证明它不是既有概念的别名或可推导组合。

---

## 2. 元概念（kernel）

### 2.1 Query —— 参数化缓存读

**三种形**：

| 形         | 签名                                                  | 服务的场景                                          |
| ---------- | ----------------------------------------------------- | --------------------------------------------------- |
| collection | `(query: CollectionQuery, ctx) → Promise<Segment<T>>` | 列表页、keyset 审计、事件 backlog、**时序**（见下） |
| record     | `(id: ID, ctx) → Promise<T>`                          | 详情页                                              |
| batch      | `(ids: ID[], ctx) → Promise<T[]>`                     | 外键解析（引用列/ReferenceSelect）                  |

**时序与单例的推导（审查补遗）**：metrics 时序 = collection（数据点=行、时间范围=谓词 `{field:"ts",op:"gte"}` 等——时间窗谓词约定成文）；仪表盘单值统计 = 消费方普通 `useQuery` + `select` 聚合（引擎既有能力），或对 collection 派生——**不需要第四种形**，这是配方不是缺口。

**CollectionQuery —— 集合查询的结构化意图**：

```ts
interface CollectionQuery {
  predicate?: Predicate; // 谓词树
  order?: Order[]; // 排序（多键）
  window: QueryWindow; // 窗口 —— 分页只是 window 的字段，不是概念
}

type Predicate =
  | { field: FieldKey; op: Operator; value: FieldValue }
  | { all: Predicate[] } // AND
  | { any: Predicate[] }; // OR

type Operator = "eq" | "ne" | "contains" | "in" | "gt" | "lt" | "gte" | "lte" | "exists";

/** 构造侧类型化、解码侧宽容的两层结构：
 *  页面/适配器构造时 FieldKey 收窄为 `keyof T & string`；
 *  URL 解码侧保持 string（运行时值无法变 literal），字段合法性归适配器校验。 */
type FieldKey<F extends string = string> = F;

type FieldValue = string | number | boolean | ReadonlyArray<string>;
// 约定：日期一律 ISO-8601 字符串（encode/decode 往返无损）

interface Order {
  field: FieldKey;
  dir: "asc" | "desc";
}

interface QueryWindow {
  // 原 Window —— 与 DOM 全局撞名，按复合词政策改名
  size: number; // 必传（torchwood 契约：pageSize 缺省即截断事故）
  cursor?: Cursor; // keyset 方言：不透明续读令牌
  range?: { offset: number }; // offset 方言（配合 Segment.total）
}
```

- **QueryWindow 是结构类型而非模式枚举**：三种真实分页方言同构映射——torchwood 全站 keyset 无 total（cursor）、fleetly 全站整取+客户端过滤（无 window，客户端求值）、**leaderboards 的"token 游标 + 附带 total"**（cursor + total 并存，审查修正：不是数值 offset——源码仍走 `page_token`， prev 靠历史栈）。方言判断交给适配器，类型系统不预设。
- **Segment（查询结果段）**——字段命名刻意与 TanStack Query 的 `getNextPageParam: (lastPage) => lastPage.nextCursor` 对齐：

```ts
interface Segment<T> {
  rows: T[];
  total?: number; // offset 方言必有；leaderboards 型 keyset 也附带
  nextCursor?: Cursor; // 仅还有下页时出现（"返回数<size"不代表到底——torchwood 契约）
}
```

#### 2.1.1 URL 编解码与写入契约（审查后新增，关闭附录 B-Q1/Q3 部分）

**键名定案**（扁平、可读、repeated 形式天然匹配 grpc-gateway 序列化）：

| 语义     | URL 键   | 形态                                                                      |
| -------- | -------- | ------------------------------------------------------------------------- |
| 文本搜索 | `q`      | 单值（字段白名单在 schema 工厂声明）                                      |
| 谓词     | `filter` | 重复键 `filter=field:op:value`（AND 语义；OR 树的场景走消费方自定义参数） |
| 排序     | `sort`   | 重复键 `sort=field:dir`（多键有序）                                       |
| 游标     | `cursor` | 单值（keyset 方言）                                                       |
| 页码     | `page`   | 单值 1-based（offset 方言）                                               |
| 页大小   | `size`   | 单值                                                                      |

**真相语义**：**"URL + schema 默认值"即真相**（TanStack Router 实测：validateSearch 产生的默认值出现在 `useSearch` 但**不写回 URL**——分享链接的语义 = URL + 默认值，措辞如此）。

**写入契约**（TanStack Router 三条暗规则的对策）：
1. 一切 setter 走 `navigate({ to: ".", from, search: (prev) => ({ ...prev, ...patch }), replace })`——**必须函数式**（对象字面量会静默 strip 未提及的参数，含消费方自定义参数）。
2. **历史纪律**：翻页（cursor/page 前进）= `push`（历史栈即分页栈）；谓词/排序变化 = `replace` + 清游标回第一页；程序化归一化 = `replace` 且只在 effect / search middleware 中发生——**绑定不得在渲染期 navigate**。
3. **职责单一归属**：默认值归 schema 工厂（validateSearch 幂等、全默认值）；"换向/改谓词清游标"归绑定 setter；两者不重叠。深链进入带 cursor 的 URL 时历史为空、prev 退化不可用——**已知行为成文**（torchwood 现状根本无法深链中栈，这是新能力的新边界）。

**工厂签名**：

```ts
// /schema
interface QuerySchemaSpec {
  text?: ReadonlyArray<string>; // q 参与字段白名单
  filters?: ReadonlyArray<FilterFieldDef>;
  defaultSize?: number; // 默认 20
  defaultOrder?: ReadonlyArray<Order>;
}
function collectionQuerySchema(spec: QuerySchemaSpec): {
  toSearchSchema(): StandardSchemaV1; // 内部经 toStandardSchemaV1 包装（Effect Schema 不能裸传 validateSearch）
  encode(q: CollectionQuery): Record<string, string | undefined>;
  decode(params: Record<string, unknown>, defaults): CollectionQuery; // 容忍脏输入
  defaults: CollectionQuery;
};
```

**客户端求值方言的两个成文细节**：① `clientCollection(fetchAll)` 适配器在整取后本地求值谓词/排序/窗口，**伪造不透明游标**（把 offset 编进 token）以兑现"游标进 URL、历史即分页栈"；② fetchAll 的取数上限是适配器内部常量（fleetly 现状：projects=100 / apps=200 / deployments=50 参差，照搬即可，但文档不再笼统说"整取即全量"）。

### 2.2 Command —— 具名动词与"失败/结果两分"

**写面是具名动词集，不是固定 CRUD**。两个真实 console 的写面一大半是 cordon / drain / rotate / redeliver / rollback / verify / setPassword / cancel；create / update / delete 只是带默认失效的内置动词。

```ts
// 命令描述符（kernel 纯数据）
interface CommandDescriptor<Input, Payload, ID = never> {
  run(input: Input, ctx: ResourceScope): Promise<CommandResult<Payload>>;
  invalidates?: ReadonlyArray<QuerySelector>; // 跨资源失效声明（纯数据）
  /** 结果覆写钩子：命令作者裁决协议层状态在"结果通道"的语义。
   *  例：delete 已删的资源，服务端 404 → 覆写为 ok（幂等成功）或 rejected。 */
  treatAs?: Partial<Record<"not-found" | "forbidden", CommandResult<Payload>>>;
}

type QuerySelector =
  | { resource: ResourceName } // 该资源全部查询（默认 ∩ 同 scope，见下）
  | { resource: ResourceName; kind: "collection" | "record" | "batch"; id?: ID }
  | { resource: ResourceName; allScopes: true }; // 显式跨作用域失效（罕见，如管理端命令）
```

**失效语义（审查补遗）**：
- `kind: "batch"` 的外延 = 键中含有指定 id 的 batch 查询（外键解析缓存，失效矩阵单测必覆盖）；
- **scope 交运算**：selector 默认与命令执行时的 ctx scope 相交（project A 里的命令不清 project B 的缓存）；`allScopes: true` 显式逃逸——过度失效虽安全但破坏其它作用域的缓存体验，默认同 scope 是裁决。
- `resource: ResourceName` 是 **branded string**（`defineResource` 返回值的 name 字段携带 brand），selector 收 branded 类型——拼错资源名编译期爆炸（"字符串寻址"是本设计批评竞品的病，自家不能犯）。

#### 失败 / 结果两分（划界原则，审查后重写）

|      | 失败（Failure）                                            | 结果（Outcome）                                 |
| ---- | ---------------------------------------------------------- | ----------------------------------------------- |
| 定义 | **无法产出领域可用值**：传输/会话/协议层的封闭状况         | 交互发生，服务端给出**领域语义**的回应          |
| 词汇 | `ApiError`（**封闭集**）                                   | `CommandResult`（**已知分支 + ok 载荷兜底**）   |
| 通道 | reject（Query/Command/Subscription 三通道统一，见 §5）     | 正常返回值，供表单/交互渲染                     |
| 例子 | 网络断层、401 会话过期、403（无领域语义时）、解码失败、5xx | `rejected`（业务拒绝）、`conflict`（OCC）、`ok` |

```ts
// 失败通道：封闭集（kernel）
type ApiError =
  | { kind: "network"; cause?: unknown }
  | { kind: "auth" } // 401：会话过期（触发全局闭环）
  | { kind: "forbidden" } // 403：无领域语义时（命令可用 treatAs 覆写）
  | { kind: "not-found" } // Query 侧默认；Command 侧经 treatAs 裁决
  | { kind: "server"; status: number; message?: string }
  | { kind: "decode"; detail: string };
// 取消（abort/interrupt）既非失败也非结果——边界显式吞掉，见 §5 runApi。
// 重试分类配套：绑定为 Query/Mutation 注入默认 retry 策略
// isRetryable(ApiError)：network/server 可重试，auth/forbidden/not-found/decode 不重试。

// 结果通道：已知分支 + ok 载荷（kernel）
type CommandResult<P = unknown> =
  | { status: "ok"; payload: P } // payload 可为一次性 reveal 载荷（token/邀请/webhook URL）
  | { status: "rejected"; code?: string; message: string; fieldErrors?: Record<string, string> } // code：机器可判别（双 console 后端都有 code/message——契约不能丢 code）
  | { status: "conflict"; message: string }; // OCC：输入携带 version，服务端比对失败
```

- **网络断层 = typed failure（ApiError.network）**，不是 Effect defect——它是预期中的失败（用户断网/后端重启），必须可捕获、可重试、可渲染三态；**defect 只留给程序错误**（不可预期异常、不变量破坏——边界 catchDefect 归一进监控，见 §5）。此裁决消除 draft-1 §2.2 与 §5 的自相矛盾。
- **命令侧 404/403 的仲裁**：协议层默认归失败，但 `CommandDescriptor.treatAs` 让命令作者裁决领域语义（delete 幂等成功、cancel 已结束→rejected 带码）。
- **`fieldErrors` 是可选能力**：两个真实后端今天都只有 code/message——表单绑定以**表单级错误盒**为主形态，字段级回填在后端提供时自动启用。
- **OCC（乐观并发）**：torchwood 文档 update/delete 必带 version → 命令输入携带，`conflict` 分支渲染"已被他人修改，请刷新"。**迁移注记**：torchwood 现状无 conflict 分支实证（一律 message-only toast）——迁移时先验证服务端 OCC 失败是否回可判别状态码，否则保持 message-only 行为等价。
- **一次性 secret 揭示**：`ok` 载荷的生命周期语义（只在这一帧存在）由 SecretReveal 块承接（§6）；reveal 载荷不进 Query 缓存、失效不冲刷、卸载即弃。
- **raw body**：命令输入可为字节流（fleetly 确定性 tar → 裸 POST `application/x-tar`）或 **FormData**（torchwood 分片上传的单片）；tar/分片状态机本身是消费方纯函数/自持。**raw-response 逃生口**：`http` 管线对 Blob 响应（备份下载、文件预览）不过 Schema 解码——不是一切响应都走 decode。
- **"开放分支"的诚实表述**：CommandResult 是已知分支的封闭 union + `ok.payload` 泛型兜底；扩展 = 载荷里携带判别字段，不再造新 status（避免类型层开口子）。

### 2.3 Subscription —— 按游标定位的帧递送

```ts
// 订阅描述符（kernel；审查补遗——订阅从此有对等的类型化声明）
interface SubscriptionDescriptor<Params, Frame> {
  open(params: Params, ctx: ResourceScope): Transport<Frame>;
  policy?: SubscriptionPolicy; // 流属性默认在资源侧声明；调用点可覆盖
}

interface SubscriptionPolicy {
  buffer: number; // 环形缓冲容量（超限丢最旧——Queue.sliding 语义）
  pauseable?: boolean;
  retry?: {
    backoffMs: ReadonlyArray<number>; // 例 [1000, 2000, 4000]——fleetly wait 流
    // 注意：没有 fallbackPollMs —— 退避耗尽转"轮询另一资源查询"是消费方组合（见 stalled）
  };
}

// 传输契约（kernel 接口；NDJSON/SSE 通用实现在 /adapters）
interface Transport<F> {
  open(cursor: Cursor | null, signal: AbortSignal): FrameSource<F>;
  /** 可选重连前钩子：torchwood realtime 的"先 refresh 再重订"在此；
   *  引擎驱动重连时调用；自带恢复的 transport 可不实现，此时 policy.retry 对其失效。 */
  beforeReconnect?(): Promise<void>;
}

/** 帧源 = 异步迭代 + 类型化终止（审查补遗——关闭 B-Q7）：
 *  终态分诊归 transport：票据/base64/E_EVENTS_GONE/部署 state 解析全在消费方适配器，
 *  引擎只消费 reason。 */
interface FrameSource<F> {
  [Symbol.asyncIterator](): AsyncIterator<F>;
  /** 正常结束（迭代器 return）时引擎可读到的终结原因。
   *  - "ended"：服务端正常收流（部署终态、日志关窗）——注意 NDJSON-over-fetch 的
   *    "收流"与"中断"在传输层不可严格区分，真终态判据是帧内容（如部署 state），
   *    由 transport 解析后以此上报。
   *  - "gapped"：断档，保留窗滑过（fleetly 410 E_EVENTS_GONE）
   *  - "auth" | "transport"：不可恢复错误（引擎转 error 状态并携带 ApiError） */
  readonly closeReason: "ended" | "gapped" | "auth" | "transport";
}

type SubscriptionStatus =
  | "live" // 正在递送
  | "reconnecting" // 传输中断，按策略重连中
  | "paused" // 用户手动暂停（从游标续订）
  | "gapped" // 断档：需重新定锚（重跑 backlog Query）
  | "stalled" // 退避预算耗尽：等待 restart 或消费方接管（如切轮询查询）
  | "ended" // 服务端正常收流（终态 ≠ 断流）
  | "error"; // 不可恢复；携带 ApiError（401 在订阅通道也进全局闭环）

interface SubscriptionHandle<F> {
  readonly frames: ReadonlyArray<F>; // 环形缓冲快照（useSyncExternalStore）
  readonly status: SubscriptionStatus;
  readonly error: ApiError | null; // status === "error" 时
  readonly resyncs: number; // 重锚计数——EventFeed 黄条"发生过 resync"信号
  pause(): void;
  resume(): void;
  restart(): void; // 手动重连（fleetly "Reconnect stream" / torchwood 手动重连）
  resync(anchor?: Cursor | null): void; // gapped 后重锚：清缓冲 + 从新锚点重开（缺省锚点=活尾 null）；resyncs++ 供黄条渲染
  clear(): void;
}
```

- **终态与断流严格区分**：`ended` 是服务端正常收流；`reconnecting`/`gapped`/`stalled` 才是需要动作的异常。
- **退避耗尽转轮询是消费方组合**（审查修正）：fleetly wait 流的真实语义是"退避 [1s,2s,4s]×3 → **另一个资源的查询**（deployments 列表 + find by id）10s 轮询 + 帧优先合并"——`stalled` 状态位 + 消费方组合与源码同构；引擎不内置 `fallbackPollMs`（表达不了"轮询哪个查询、怎么提取、何时启用、与帧的优先级"）。
- **游标代数与 CollectionQuery 共享**（同一个 `Cursor` 类型）：fleetly events 的 backlog→follow = collection query（cursor window 定锚）+ Subscription（从锚点续订）的组合。
- **锚点交接约定（关闭 B 系开放问题）**：backlog Segment 的**最新一端**为锚（`nextCursor` 方向约定：指向更新端）；锚的具体取值由消费方适配器决定（events 的锚是 `last_seq` 算术——`after_seq` 是过滤参数而非不透明 cursor，适配器吸收此方言并写进配方）；backlog 尾帧与首个 live 帧的去重由 EventFeed 按 (cursor, id) 处理。
- **gapped 重锚责任**：绑定**不**自动重跑 backlog——页面监听 `gapped` → `resync()`（清缓冲、重定锚、`resyncs++` 供黄条渲染）。
- **帧级失败**：坏帧由 transport 裁决（跳过或以 `closeReason: "transport"` 终止）；`ApiError.decode` 只管 HTTP 响应侧。
- **AbortError 区分**：引擎主动 abort（暂停/关闭/scope 关闭）导致迭代器以 AbortError reject——必须与传输错误区分，否则暂停被误判为 reconnect（Effect scope ↔ AbortSignal 桥接细节见 §5）。
- **命令式消费**：Transport 可脱离 `useSubscription` 直接使用（quickstart 第六步在编排里 `for await` 等终态帧）——成文。
- 实时失效（refine liveMode 的语义）= `invalidateOnFrame` 便利组合（帧到达 → 失效指定查询），**不是原语**。

### 2.4 Resource —— 三原语可选的交互面

```ts
interface ResourceSpec<
  T,
  ID,
  C extends Record<string, CommandDescriptor<any, any, ID>> = {},
  S extends Record<string, SubscriptionDescriptor<any, any>> = {},
> {
  name: string; // defineResource 返回值中变为 branded ResourceName
  getId?: (row: T) => ID; // 可选（审查修正）——command-only/流式资源无 id 语义；
  // DataTable/绑定的 getRowId 显式传入（TanStack Table 本就需要）
  scope?: ReadonlyArray<string>; // scope 键名（如 ["projectId"]），见 scoped 约定

  collection?: (q: CollectionQuery, ctx: ResourceScope) => Promise<Segment<T>>;
  record?: (id: ID, ctx: ResourceScope) => Promise<T>;
  batch?: (ids: ReadonlyArray<ID>, ctx: ResourceScope) => Promise<T[]>;

  commands?: C; // 逐键保留具体 CommandDescriptor<Input, Payload, ID>——
  subscriptions?: S; // 泛型不被擦成 any（审查 P0 修复：defineResource 的
} // 参数与返回值逐键推断，useCommand(r,'create') 得精确 Input）

interface Resource<T, ID = string, C = {}, S = {}> extends ResourceSpec<T, ID, C, S> {
  readonly name: ResourceName; // branded
}

function defineResource<T, ID, C, S>(spec: ResourceSpec<T, ID, C, S>): Resource<T, ID, C, S>;

type ResourceScope = Readonly<Record<string, string | undefined>>; // 原 Scope——与 Effect Scope 撞名，改名
function scoped<T, ID, C, S>(
  resource: Resource<T, ID, C, S>,
  values: ResourceScope,
): Resource<T, ID, C, S>;
// 自由函数而非方法（审查修正）——queryKey 嵌入 scope 段 + ctx 注入；
// 适配器可在 http 实例上把 ctx 注入 header（torchwood X-Torchwood-Project）
```

**三原语各自可选，且绑定层寻址规则成文（审查修正）**：
- **查询与命令必须经 Resource 寻址**——失效连接键（branded name + scope）依赖资源注册；
- **订阅允许裸 Transport**（`useSubscription(transport, opts)` 直用）——全局流（events）或特殊流（logs）可以不造 Resource；`Resource.subscriptions` 是**便利挂点**（torchwood documents 的 changes 这类实体绑定流用）。
- 合法形态：纯查询（routes）、查询+命令（多数 CRUD）、查询+命令+订阅（documents+changes）、查询+订阅（events）、**纯命令（login/logout——getId 可选后成立）**、裸 Transport（logs）。

**Resource 不含的东西**（旧项目 L4 的越权，明令禁止）：列定义、导航、权限、guessers、路由生成。页面装配回归 React 组合。

### 2.5 kernel 契约一览（修订后完整签名）

```ts
// ============ 流几何 ============
type Cursor = string;
interface QueryWindow { size: number; cursor?: Cursor; range?: { offset: number } }
interface Order { field: FieldKey; dir: "asc" | "desc" }
type Predicate = { field: FieldKey; op: Operator; value: FieldValue }
              | { all: Predicate[] } | { any: Predicate[] };
interface CollectionQuery { predicate?: Predicate; order?: Order[]; window: QueryWindow }
interface Segment<T> { rows: T[]; total?: number; nextCursor?: Cursor }

// ============ 通道 ============
type ApiError = /* 封闭失败集，§2.2 */ ;
type CommandResult<P> = /* 已知分支 + ok 载荷，§2.2 */ ;
interface Transport<F> { open(cursor, signal): FrameSource<F>; beforeReconnect?(): Promise<void> }
interface FrameSource<F> { [Symbol.asyncIterator](): AsyncIterator<F>;
                           readonly closeReason: "ended"|"gapped"|"auth"|"transport" }
type SubscriptionStatus = "live"|"reconnecting"|"paused"|"gapped"|"stalled"|"ended"|"error";

// ============ 交互面 ============
interface Resource<T, ID, C, S> { /* §2.4 */ }
type ResourceName = string & { readonly __resource: unique symbol };  // branded
type ResourceScope = Readonly<Record<string, string | undefined>>;
function defineResource<T, ID, C, S>(spec: ResourceSpec<T, ID, C, S>): Resource<T, ID, C, S>;
function scoped<T, ID, C, S>(r: Resource<T, ID, C, S>, values: ResourceScope): Resource<T, ID, C, S>;

// ============ 查询代数（纯函数） ============
/** 游标推进：offset 方言可算 prev（page-1）；keyset 的 prev = 浏览器历史（返回无令牌），
 *  本函数返回 null 表示不可算——leaderboards 型（token+total）同样走历史。
 *  唯一能本地算 prev 的是客户端求值方言（伪造游标含 offset）。 */
function advance(window: QueryWindow, segment: Segment<unknown>,
                 dir: "next" | "prev"): QueryWindow | null;
```

（draft-1 的 `mergeWindows` 占位删除——无真实用例，不做假 API。）

---

## 3. 派生概念（每项附推导式；禁止反向进入 kernel）

| 派生概念                                                                           | 推导式                                                                                                                                                                            | 落点      |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **列表绑定** `useCollection`                                                       | CollectionQuery(URL) → collection Query → Query 引擎 → 稳定句柄                                                                                                                   | /react    |
| **无限列表** `useCollectionInfinite`（A 类，审查升格）                             | useInfiniteQuery（`getNextPageParam: s => s.nextCursor` 与 Segment 命名对齐；双向 prev 引擎原生）                                                                                 | /react    |
| **记录绑定** `useRecord`                                                           | record(id) → Query                                                                                                                                                                | /react    |
| **批解析绑定** `useBatch`                                                          | memo(batch(ids)) keyed by (resource, ids)——外键解析                                                                                                                               | /react    |
| **命令绑定** `useCommand`                                                          | 命令描述符 → mutation + invalidates 执行 + isRetryable 默认                                                                                                                       | /react    |
| **表单绑定** `useCommandForm`                                                      | TanStack Form 草稿 ∘ useCommand + CommandResult 分支渲染（映射见 §5.1）                                                                                                           | /react    |
| **订阅绑定** `useSubscription`                                                     | /adapters 订阅引擎句柄 + useSyncExternalStore 接线                                                                                                                                | /react    |
| **预取工厂** `collectionQueryOptions` / `recordQueryOptions` / `batchQueryOptions` | 查询 → queryOptions（key 单源；hooks 内部消费同一工厂；route loader `ensureQueryData` + `Link preload="intent"` 接线）                                                            | /react    |
| **查询代数** `evaluateQuery` / `clientCollection`                                  | `evaluateQuery(q, rows)` 纯函数；`clientCollection(fetchAll)` 包装为 collection 实现 + 伪造游标——**求值策略，非概念**                                                             | /adapters |
| **scoped 约定**                                                                    | `scoped(resource, {projectId})` → key 嵌入 scope 段 + ctx 注入                                                                                                                    | /adapters |
| **双通道作用域同步配方**                                                           | URL↔localStorage 写方向规则 + synced 守卫 + storage 事件桥 + 防乒乓（torchwood 实证四件套）                                                                                       | 配方      |
| **权限门控** `useCan`                                                              | identity record Query + 纯谓词；fail-closed；页级门控走 beforeLoad（identity 经 loader 预取 + redirect），元素级走 useCan（"未就绪"与"拒绝"两态渲染）                             | /react    |
| **偏好持久化** `usePreference`                                                     | localStorage + schema 的通用受控状态                                                                                                                                              | /react    |
| **实时失效** `useInvalidateOnFrame`                                                    | 帧到达 → invalidate(选择器) 的组合钩子（throttle 可选；§5.3 裁决 8）                                                                                                              | /react    |
| **mock** `mockResource` / `mockTransport`                                          | 内存实现 Resource / Transport 契约——测试工具 + demo 数据源                                                                                                                        | /adapters |
| **401 闭环**                                                                       | 三通道（Query/Command/Subscription）auth 失败 → createHttp 注册的 handler；管线次序见 §5                                                                                          | /adapters |
| **审计页**                                                                         | keyset CollectionQuery（cursor window）的配方                                                                                                                                     | 配方      |
| **backlog→follow**                                                                 | Query 定锚 × Subscription 续订（共享游标；锚点交接约定见 §2.3）                                                                                                                   | 配方      |
| **wait 流降级**                                                                    | stalled → 消费方切轮询 Query + 帧优先合并                                                                                                                                         | 配方      |
| **轮询**                                                                           | Query 引擎 refetchInterval                                                                                                                                                        | 引擎既有  |
| **fan-out 聚合**                                                                   | N 个 collection Query + merge——**组合，不升格**                                                                                                                                   | 组合      |
| **多请求编排**                                                                     | commands + queries 的 async 序列（quickstart、variables diff 链）；**fresh-read**：queryOptions 工厂 + `queryClient.fetchQuery` 绕过 stale 缓存（app-variables 的绕缓存回读语义） | 组合      |
| **导出 CSV**（B 类，审查补）                                                       | `list.rows` + 消费方 unparse 纯函数（react-admin ExportButton 对应物是配方）                                                                                                      | 配方      |
| **clone**（B 类，审查补）                                                          | useRecord 预填 + create 命令提交（refine useForm clone / ra CloneButton 对应物）                                                                                                  | 配方      |

**消费方自持清单**（0–1 个消费者，抽象不成立，成文拒签）：
exec 终端（双向有状态会话，Subscription 单向；受理/观测仍可走 Resource，仅 WS 面自持）、分片续传上传状态机（torchwood；底层 REST 上传单片是 FormData raw body 命令）、GitHub manifest 跨站流（整页离站 POST）、确定性 tar 构建器（纯函数）、CliEquivalent 组件（appendix 槽是公共的）、PermissionEditor 的 op:role 预设（通用 ChipsField 进值块）。

---

## 4. 词汇分簇与命名政策

### 4.1 分簇

| 簇               | 成员                                                                                                                                      | 语境                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 交互原语（消息） | Query / Command / Subscription；CollectionQuery、CommandResult（结果通道，与原语同报）、Frame                                             | 问/令/听——同一消息类型学 |
| 被寻址面         | Resource（name、getId?、scope、collection/record/batch、commands、subscriptions）、ResourceName（branded）                                | 实体交互面               |
| 流几何           | Segment、Cursor、QueryWindow、predicate、order                                                                                            | 序列几何隐喻             |
| 通道词汇         | Transport（kernel 接口）、FrameSource（终结原因）、ApiError（封闭失败集）、ResourceScope                                                  | 线缆/故障/语境           |
| 绑定             | useCollection / useCollectionInfinite / useRecord / useBatch / useCommand / useCommandForm / useSubscription；工具 useCan / usePreference | **原语（或其形）语域**   |
| 适配器           | evaluateQuery / clientCollection / scoped / mockResource / mockTransport / http / ndjson / sse                                            | 动词语域                 |
| 块               | DataTable / ListPage / Form / LogViewer / EventFeed / Page…                                                                               | 呈现语域                 |

### 4.2 命名政策

1. **契约以"是什么"命名**；**绑定以"绑定的原语或其形"命名**（useCollection/useRecord/useBatch 是 Query 的形——Query 是四个元名词里唯一没有同名绑定的，政策措辞如此）；**适配器以动词命名**；**块以"呈现什么"命名**。
2. **受控碰撞消歧**：`Query` 引擎词归 TanStack、契约词一律复合词（CollectionQuery）；永不导出裸标识符 `Query`；kernel/绑定层**禁用 `Event` 一词**（帧叫 Frame）；`Page` 归 UI 外壳块；`QueryWindow`（避 DOM `Window`）、`ResourceScope`（避 Effect `Scope`）——**碰撞检查清单覆盖 DOM / TanStack / Effect 三家词表**。**块名豁免记录**：EventFeed 保留（呈现层词汇，不进类型层，豁免记录在案）。
3. 全部导出唯一归属一层，机械可查（layer-check）。

### 4.3 消费方视角的 API 面

- **适配器作者**（fleetly/torchwood 迁移的核心工作者）：见 Resource/Transport 契约 + Effect 缝（§5）。需要懂 Effect。
- **页面作者**（大多数 agent 开发时）：见绑定 + 块 + 配方。零 Effect、零协议细节。
- 两类角色的文档分册（§10）；幻觉诱饵对照表（§14）进 SKILL.md。

---

## 5. Effect 缝隙架构（采纳层级 L1；draft-2 按 Effect v4 实测修订）

**原则：Effect 住在缝里，Promise 站在边界上。**

### 5.0 v4 基线事实与依赖政策

- effect **v4.0**（2026-10-01 stable）：core 零运行时依赖、最小程序 7.1 kB min+gz、LTS 至 2029-09。使用范围：**core 稳定模块**（Effect/Stream/Queue/Deferred/Schedule/Data/Cause/Exit）+ `effect/schema`（**unstable**——minor 可破坏，防线见不变量 4）。
- **不取 platform Http**（v4 中为 core 的 `effect/http` unstable 模块 + `@effect/platform-browser`，且是 Layer/拦截器取向——与 L1 禁区直接冲突）。手写 fetch + `Effect.tryPromise` 归一层，几十行，零不稳定依赖。
- **依赖锁 `~4.0`（tilde）**：schema 的 unstable 意味着 minor 可能破坏；caret 会让 `npm update` 自动引入破坏——tilde + changesets 主动吸收 + CI 漂移矩阵（effect@latest-4.x 上跑测试）。
- **bundle 预算门**：/adapters 入口 gzip ≤ 35 kB（质量门新增）。

### 5.1 缝 1：错误通道与 401 闭环

- 网络断层 = **typed failure**（`Effect.tryPromise` 的 `catch` 归一为 `ApiError.network`）；**defect 只留程序错误**，在边界 `catchDefect` 归一进监控（不进 ApiError）。
- **唯一边界 `runApi`**：所有 Effect→Promise 只经它——`catchDefect`（监控）→ `mapError`（TaggedError → kernel `kind` 联合）→ interrupt 吞掉（取消不是错误）。kernel 用 `kind` 判别，adapters 层定义 TaggedError 类、边界 mapError 转换（`_tag` 留在缝里，`kind` 站在边界上）。
- **401 闭环管线次序（成文）**：401 → **适配器内** refresh（单飞：`Ref<Option<Deferred>>` CAS + 失败扇出=断路器；刷新段 `uninterruptible` 或 forkDaemon——刷新 fiber 不得被首个请求者的取消连带杀死）+ **一次性重放**（`__authRetried` 语义）→ 仍 401 才 `ApiError.auth` → `createHttp({ onUnauthorized })` 注册的 handler（清凭证 + 清缓存 + 跳登录）。**免死通道**：登录端点、`missing-project-context` 型 401 不触发闭环；**断路器**：`expired=1` 类参数防 login↔console 互跳（torchwood 实证）。
- **三通道统一**：Query/Command/Subscription 的 auth 失败都路由到注册 handler（订阅侧 `status:"error"` 携带 ApiError——不再是无载荷字符串）。
- 已知 v4 坑成文：混合 cause 语义（typed error 后 die 会让 catchTag 跳过——闭环捕获点用 catchCause 级或保证周边无 die finalizer）；`tryPromise` 的 signal arity 陷阱（不能写 rest/默认参数）。

### 5.2 缝 2：Schema 单源

- Effect Schema 为唯一 schema 源（**弃 Zod**）：CollectionQuery URL 编解码工厂、Segment 信封、protojson transform。
- **"直传 validateSearch"修正**：Effect Schema 须经 `toStandardSchemaV1` 包装（v4 改名）——工厂的 `toSearchSchema()` 内部完成，页面作者无感。
- **合并发生在函数层而非 schema 层**：`validateSearch` 接受纯函数——消费方在自己的函数体里并行跑自有 Zod parse 与我方 `decode`，返回合并后的普通对象。**不需要两个 schema 库互操作**。
- protojson 工厂提供 **int64 双策略**（`int64: "string" | "number"`）：torchwood 归一为 number（version 比较）、fleetly 保持 string（避免 2⁵³ 截断）——单一选择会伤一个 console。编码面纪律同factory：proto3 optional"未设置=不发送"、零值缺席、枚举全名、repeated `key=a&key=b`。
- TanStack Form 同吃 Standard Schema——useCommandForm 可复用同一 schema 工厂。

### 5.3 缝 3：订阅引擎（物理位置修正）

- **引擎核心在 /adapters**（零 React）：`Stream.fromAsyncIterable(openTransport)` → `mapError`（终结原因类型化）→ `Stream.retry(backoffSchedule)` → 环形缓冲 `Queue.sliding(policy.buffer)` + `Stream.fromQueue`；暴露命令式句柄（start/stop/onFrame/restart/resync）。/react 只做 `useSyncExternalStore` 接线。
- **渲染契约**：帧缓冲为外部存储、快照经 useSyncExternalStore；SubscriptionStatus 单独订阅（帧到达不触发全页重渲染）；**StrictMode 双挂载幂等**（AbortSignal 清理 + 退避状态与 transport 实例分离）。
- **AbortSignal 桥**：Effect scope finalizer → controller.abort；`Effect.callback`/`tryPromise` signal 桥入；引擎主动 abort 的 AbortError 与传输错误严格区分。
- Schedule v4 形状按新 API 书写（min/max 组合退避；Mailbox 已移除——用 Queue）。

#### 实现期裁决（subscription 批次落地，2026-10-24；偏离原案处已修订）

1. **退避弃用 Stream.retry/Schedule，改显式索引驱动**：v4 Schedule 无 resettable，schedule 状态无法在"连接恢复递送帧"时归零——而 fleetly 语义要求每次断线从 `backoffMs[0]` 重新计数；且 `Stream.retry` 重跑整流，无法保留"已递送帧的游标"语义。实现为驱动环内的 `attempt` 索引 + `Effect.sleep`，帧递送归零（packages/ui-kit/src/adapters/subscription.ts）。
2. **连接侧弃用 `Stream.runIntoQueue`，改 `runForEach + Queue.offer`**：v4 的 runIntoQueue 会在流完成时以 `Cause.Done` **终结队列**，重连需要复用同一环形缓冲——offer 到 sliding 队列永不挂起且超限丢最旧，队列生命周期归引擎（stop 时 shutdown，泵纤维随 `Stream.fromQueue` 自然退出）。
3. **状态映射细化（SubscriptionStatus 闭合集不变）**："live" = open 成功而非首帧递送——安静但健康的流（torchwood documents changes 类静流）不该因"暂无新帧"显示 reconnecting；"reconnecting" 覆盖一切连接建立中（含首连与退避等待）；句柄 stop() → "ended"（引擎侧收流，干净终态不区分发起方）。
4. **终态分诊矩阵成文**：迭代器**正常结束** → closeReason 四值皆终态（ended/gapped 停机待命；auth→error{auth}、transport→error{network}——401 闭环在订阅侧的落点）；迭代器**抛错** → `isApiError` 且不可重试（isRetryable=false）→ error，可重试（network/server）或未知错误 → 传输中断进退避。**抛错=可重试线索，完成=终态判据**——transport 想要重连语义应当抛错而非以 transport 收流。
5. **`resync(anchor?)` 增加可选锚点参数**（原案签名 `resync(): void` 不充分）：重跑 backlog 得到的新锚必须能传进引擎（缺省 null = 活尾）；resyncs++ 不变。原地进行，不换 cursor prop——`useSubscription` 的 cursor prop 变化语义 = 重建订阅（清缓冲、resyncs 归零）。
6. **descriptor | transport 运行时判别 = `policy` 字段**：descriptor 必须声明 policy（流属性默认在资源侧声明本就是约定，兼作判别）；裸 Transport 永不带 policy。
7. **useSubscription 锚点语义**：cursor 传 `undefined` = 待命不开（backlog→follow 等定锚——引擎在 effect 内创建，锚到位才连接）；显式 `null` = 活尾立即开（日志流）。react 层只订阅状态存储；帧存储（subscribeFrames/getFrames）由帧消费块自行接线。

#### 实现期裁决（subscription 尾款，2026-10-24）

8. **invalidateOnFrame 落地为 `useInvalidateOnFrame`**（工具钩子沿 use 前缀政策，§3 派生表措辞如此对齐）：`useInvalidateOnFrame(sub, selectors, { scope?, filter?, throttleMs? })`。selector 与 useCommand 的 invalidates 同源（invalidationPredicate 单源）；filter 帧级谓词；throttleMs 缺省 0 = 每帧即射（invalidateQueries 幂等 + active 查询去重），热日志流给窗口——trailing 合并调度抽为纯函数 `createFrameInvalidator`（可单测；卸载 cancel 不给已卸载组件补射）。
9. **StageTimeline 块形态 = 帧投影 × 先验目录**：页面声明 `stages`（次序+文案，实体知识留页面），帧经 `onStage(frame) → StageEvent | undefined` 投影（undefined = 与时间线无关的帧，一条流喂多视图的常态）；目录外 key 追加尾部（动态阶段）。耗时由事件时间戳推出（ended − started；进行中随 tick 走，缺省 1000ms）；时间戳缺席以到达时刻兜底——重放口径由页面选择（带 at 的帧可重放）。

### 5.4 useCommandForm × TanStack Form 映射（关闭 B-Q6）

- **`rejected` → 表单级 `onSubmitAsync` 返回 `{ form: message, fields: fieldErrors }`**（v1 官方文档化路径；与 CommandResult 形状逐字对应）。~~setErrorMap~~（v2 alpha 已删除——不建在被删的 API 上）。
- `conflict` → form-level 消息 + 刷新动作；`ok` → reveal 载荷提升为绑定状态（不进 Query 缓存、卸载即弃）+ `onSettled` 回调（消费方接 toast/关窗/跳转——库不内置通知）。
- **服务端驱动 defaultValues 重播**：dirty 不覆盖（`specEdited`/`initializedRef` 模式，fleetly DeploySheet 与 torchwood documents 同款）。
- 已知语义坑成文：服务端错误在字段值变化前不自动清除；字段级校验覆盖同字段表单级错误。
- **v2 alpha 监测条款**：react-form 锁 ^1 + 跟踪 v2（validators 数组化、ESM-only、无兼容层是已知破坏面）。

---

## 6. UI 块体系（registry）

### 6.1 分族轴：消费哪个绑定的输出（与数据层类型学同构）

| 族                | 消费什么                              | 首批成员                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **values/**       | 纯值，零绑定知识                      | StatusBadge（状态→语义 token，映射可注入）、RelativeTime（时区感知）、CopyButton、SecretReveal（一次性揭示态）、DiffView、JsonField、StatCard、MetricChart（序列治理内置：活跃窗排序/渲染上限+N more/服务端截断披露/protojson 零值=0）                                                                                            |
| **query/**        | useCollection/useRecord/useBatch 输出 | DataTable（TanStack Table v9 `useTable+tableFeatures`；行选择/半选/行展开/**四态**）、Pagination（total 或客户端求值）、KeysetPagination（无 total：显示 x–y、空页仍渲染）、FilterBar、SelectionBar、ListPage、DetailPage（hero + URL tabs）、ReferenceSelect（搜索式选择另一资源记录 + 引用列展示，消费 useBatch/useCollection） |
| **command/**      | useCommand/useCommandForm 输出        | Form 内芯（字段族 × 错误盒 × 提交生命周期；宿主无关——Dialog/Sheet/整页三形态由外壳决定；submit 由内芯渲染，宿主 footer 经 ref 连线）、RowActions、DeleteButton/BulkDelete、ConfirmDialog 接线、行内表单                                                                                                                           |
| **subscription/** | useSubscription 输出                  | LogViewer（虚拟滚动+智能跟随+jump-to-live+下载/清空）、EventFeed（倒序+gapped 黄条[resyncs 信号]+暂停指示灯）、StageTimeline——**标注为参照实现**                                                                                                                                                                                  |
| **shell/**        | 无（布局/应用骨架）                   | AppShell（Sidebar navSections + Topbar + ⌘K 位）、**Page**（title/breadcrumb/actions/宽度三档 wide\|narrow\|flow）、ScopeSwitcher（含陈旧 id 校正）、Stepper、SectionCard（命名政策裁决：呈现布局分区而非值 → shell 族）、RouteErrorBoundary                                                                                                                                                  |

**四态**（统一术语，废弃"三态"混用）：loading / empty / error / success——前三者是渲染分支，第四者是数据。渲染归属：四态归 ListPage/页级（DataTable 只渲染 success 态的表体）。

**DataTable 状态归属切分（Table v9 裁决）**：排序/过滤/窗口归 URL（CollectionQuery 的 order/predicate/window——表内**禁用**内建 sorting/filtering 分支）；行选择/行展开归表内瞬态（受控 state 或 v9 atoms 交消费方）。块基于 v9 新 API 书写（`tableFeatures` tree-shaking；实例方法在原型上——禁止解构）。

#### MetricChart 实现期裁决（2026-10-24，双 console 取证后；批内第一性裁决）

**选型 = recharts（vendored shadcn chart.tsx 基元 + 块直用 recharts 原语）**。取证：两 console 现行同库 recharts ^3.10.1（fleetly shadcn 封装 + torchwood 裸用）；密度上限 240 点/序列 × ≤10 序列/图（fleetly 窗宽定死 240 桶）——uPlot 的百万点性能溢价无落点，且 canvas 渲染丢 CSS 变量主题化、tooltip/图例全要自建；自绘 SVG 需重建时间轴 scale/跟随 tooltip/图例，为省一个消费者已有的依赖重造轮子。**分发影响**：registry 拷贝制下 recharts 落消费方——registry.json item `dependencies` 声明（registry-build 扫描块裸导入自动追加）+ root devDeps 供 demo；不进 @fleetly/fleet-ui-kit core，/adapters 预算门不受影响。

对齐真实消费者的形态裁决（fleetly metric-chart.tsx 实证）：

1. **序列身份 = 稳定 key**：`MetricSeries { key, label, points }`——key 由页面给、跨刷新稳定（fleetly `s{原始下标}` 同款；曾用 index%5 当键 >5 序列碰撞覆写的教训成文）。配色 `var(--chart-N)` 按输入序取色（序列次序稳定则配色稳定）。
2. **动画/圆点全局关闭**（`isAnimationActive=false`、`dot=false`）：30s 轮询刷新下动画闪烁是实证问题，不是审美选择。
3. **数值时间轴单形态**：`t` 一律 ms epoch（XAxis `type="number" scale="time"`）；torchwood 的预格式化桶 label 是页面对桶 epoch 的 `formatTick` 选择，类目轴不进块。
4. **四件套接口化**：`maxSeries`（缺省 10）+ "+N more" 溢出披露；`activeWindowMs`（缺省 5min）活跃窗排序（末样本近窗尾者优先、峰值次之、声明序兜底——fleetly"死副本残骸不淹没活副本"的泛化）；`serverCap { shown, total }` 服务端截断披露条；点对齐统一时间轴行 + protojson 零值缺省（`v` 缺席按 `missingValue` 缺省 0 解释——proto3 零值省略是合法全零序列不是缺数据；"gap" 显式断线）。序列→行折叠是纯函数（`buildMetricRows`，可单测）。
5. **图例带末值**（每序列最后一个非空值加粗在图例行）；量纲格式化（bytes/percent）经 `formatValue` 注入——块不认单位词表。

### 6.2 共用 / 特化判据（成文规则）

一个组件进 registry，当且仅当：
1. **实体无关**（无业务名词/枚举/文案——文案走 messages 通道）；
2. 只依赖绑定输出 + 值块 + shadcn 基元（vendored，上游原样）；
3. **≥2 个消费者，或核心绑定的参照实现**（DataTable↔Query、LogViewer↔Subscription）。

不满足 = 业务特化组件，住消费方 `features/`。**晋升规则**：demo 是永久第二消费者；真实第二消费者出现才升格——拷贝即晋升，无词表冻结、无登记制。

**双 console 实证**：DataTable、分页双模式、列表页骨架、详情页骨架、表单三宿主、确认框、状态徽章、相对时间、四态、复制、secret 揭示 ×8、SectionCard、统计卡+图表、DiffView、JSON 编辑、事件 feed、多步向导、应用外壳、作用域切换器——全部 ≥2 消费者。

### 6.3 页面配方（composition，不是原型）

**页面模式只存在于文档与 demo，不存在于框架类型系统**：
- 列表页 = `ListPage[ FilterBar × DataTable × Pagination|KeysetPagination × 四态 ](list)`
- 详情页 = `DetailPage[ hero × Tabs(URL) × DetailGrid|SectionCard ](record)`——**tab 写入语义（实现期裁决，2026-10-24）**：tab 是普通 search 参数（不经 collectionQuerySchema——页面形态不是集合查询）；切 tab = **replace**（页面形态变化不吃历史栈，与谓词/排序同律 §2.1.1）；缺省 tab 不写 URL（"URL + 默认值即真相"同款）；块受控（activeTab/onTabChange），navigate 归页面——块不 import 路由。
- 新增/编辑 = `Dialog|Sheet|Page[ Form( fields × error × submit ) ](command)`
- 向导 = `Stepper[ n × Form|等待步骤 ]`；设置页 = `SectionCard × n`
- 仪表盘 = `StatCard × n + MetricChart × n (queries)`；工作台 = 全屏 `FilterBar × (LogViewer|EventFeed|MetricChart)`
- events 组合页 = backlog Query 定锚 × Subscription 续订 × EventFeed（含 resync 配方：gapped → resync() → 清缓冲重锚 → 黄条）

FilterBar/Pagination 等是 ListPage 的**兄弟组件**（示例代码未画 filter 槽——块各是独立组件，配方图示的是组合不是内建槽）。所有 page part 都是 ReactNode——**逃生舱是结构性的**：

```tsx
<ListPage
  title="Apps"
  table={<DataTable list={list} columns={appsColumns} getRowId />} {/* 不满意？传自己的表格，只要消费 list */}
  pagination={<Pagination list={list} />}
  appendix={<CliEquivalent cmd={`fleetly apps list --project ${projectId}`} />}
/>
```

### 6.4 为什么不需要 CustomPage

`CustomPage`/`<CustomRoutes>` 的存在前提是**框架拥有页面类型系统**。fleet-ui 不拥有路由——**TanStack Router 文件路由就是全部页面**，自定义内容页是缺省状态。承接机制：① `Page` 外壳块服务所有页面；② 横切关注点与页面类型正交（导航 = navSections prop、错误边界 = 每路由、权限 = beforeLoad + useCan、Suspense = 根路由）。

---

## 7. 双 Console 覆盖核对（draft-2 修正后）

### 7.1 覆盖矩阵（摘要；修正处以 ★ 标注）

| 交互形状（出处）                                  | 落点                                                                     | 判定                  |
| ------------------------------------------------- | ------------------------------------------------------------------------ | --------------------- |
| 整取+客户端过滤分页（fleetly 全站）               | CollectionQuery + clientCollection（伪造游标 + per-resource limit 常量） | ✓                     |
| keyset 无 total + 换向回首页（torchwood 全站）    | cursor window + KeysetPagination + 写入契约                              | ✓                     |
| ★ leaderboards"token 游标+附带 total"             | cursor + total 并存；prev 走历史（advance 返回 null）                    | ✓（修正定性）         |
| 服务端过滤（fleetly audit；torchwood 白名单 DSL） | predicate 服务端求值，方言编解码在适配器                                 | ✓                     |
| 详情/外键                                         | record / batch（失效矩阵覆盖 batch 键）                                  | ✓                     |
| fan-out 聚合（fleetly 部署流/spec 反引索引）      | N 查询 + merge 组合                                                      | ✓                     |
| 轮询（两 console 多处）                           | refetchInterval                                                          | ✓                     |
| 时序/图表/单值统计                                | 时序=collection（时间窗谓词）；单值=useQuery+select                      | ✓（补推导）           |
| 具名动词（两 console 大量）                       | Command 动词集（泛型逐键推断）                                           | ✓                     |
| 多请求编排（quickstart/variables diff 链）        | 消费方组合 + fetchQuery fresh-read + Transport 命令式消费                | ✓                     |
| 表单+错误（两 console 均 message-only 后端）      | CommandResult.rejected（code + fieldErrors 可选）→ onSubmitAsync 返回    | ✓                     |
| OCC（torchwood documents）                        | 输入带 version + conflict 分支（迁移先验证服务端判别）                   | ✓                     |
| 一次性 secret（两 console ×8）                    | ok 载荷 + SecretReveal                                                   | ✓                     |
| tar 裸上传 / FormData 单片                        | raw body 命令；Blob 响应走 raw-response 逃生口                           | ✓                     |
| 日志 NDJSON（fleetly）                            | Subscription + ndjson transport                                          | ✓                     |
| events SSE 票据 + 410 断档（fleetly）             | Query 锚 + Subscription + FrameSource closeReason + resync 配方          | ✓（补终态分诊后可写） |
| wait 流退避→轮询兜底（fleetly）                   | stalled 状态 + 消费方切轮询查询 + 帧优先合并                             | ✓（修正机制）         |
| realtime WS refresh→重订（torchwood）             | Transport.beforeReconnect 钩子 + restart                                 | ✓（补钩子后可写）     |
| 401 闭环（bearer 清跳 / cookie 单飞刷新）         | 缓 1 管线次序 + 免死 + 断路器 + 三通道统一                               | ✓（修正管线）         |
| protojson 方言（两 console）                      | Effect Schema transform（int64 双策略 + 编码面纪律）                     | ✓                     |
| 项目作用域（两 console 双通道）                   | scoped 约定 + 双通道同步配方（写方向/synced 守卫/storage 桥/防乒乓）     | ✓（补配方）           |

### 7.2 核对修正记录（累计 8 条 + 审查新增）

原 8 条保留（具名动词/message-first/砍 undo/gapped/scope 约定/游标进 URL/raw body/fan-out 组合）。审查新增：⑨ leaderboards 定性修正；⑩ wait 流降级改 stalled+组合；⑪ 401 管线次序成文；⑫ 终态分诊归 transport（closeReason）；⑬ 双通道作用域配方成文；⑭ int64 双策略。

### 7.3 消费方自持清单

见 §3 末尾。

---

## 8. 竞品交叉审核（refine / react-admin / shadcn-admin-kit；draft-2 修正）

**超越（收敛为五点，措辞经对竞品 v5 实测校准）**：
1. **全链路类型安全**——资源寻址（branded ResourceName vs 竞品 string）、谓词（类型化 Predicate vs 松散 CrudFilters/filters）、URL（typed search + Standard Schema vs 弱类型）。注明：react-admin v5"Stricter TypeScript"、refine v5"更一致的类型化 hook 接口"已收窄差距——超越集中在**资源寻址+谓词+URL 三处**，非全面。
2. **流式帧消费（代差）**——竞品 live 契约是 pub/sub 事件（refine auto=失效重取、**manual=事件回调——消费方可自建缓冲**；ra-realtime=EE 付费重取模型）；fleet-ui 的契约原生携带**游标定位/backlog→follow/断档重同步/暂停/退避转轮询/环形缓冲**——这些机制在竞品中须消费方全部自建。结论（代差）保留，"字面上无法表达"的过度断言删除。
3. **分页方言的类型化 + URL 化**——结构类型 QueryWindow vs 模式枚举/字符串游标（refine 有 cursor 约定、ra 有 getPaginationCursor+pageInfo——表达力存在，差距在**类型化与 URL 历史**）。
4. **具名动词命令 + 声明式失效**——refine `useCustomMutation` 文档自认"不失效查询"（消费方手接 useInvalidate）；react-admin 自定义动词=裸 useMutation+手动 queryClient——fleet-ui 的 invalidates 声明反而更硬。
5. **Subscription/Command 的领域契约**（失败/结果两分、OCC、reveal、gapped）与 **TanStack Router/Form 全栈**。

**持平**：CRUD 页面三件套、数据契约、认证/权限、引用**读侧**（写侧见缺失）、无头+皮肤分离、registry 源码分发、链接预取（Router preload 等价）、**Agent 文档**（kit 已自带 SKILL.md——跟进持平而非首创）。

**缺失三类处置**：
- **A 类（补齐，进计划）**：ReferenceSelect、usePreference（含 SavedQueriesList 配方块后排）、mockResource/mockTransport、**useCollectionInfinite（升格：双竞品一等 + fleetly 消费）**
- **B 类（配方化）**：实时失效=invalidateOnFrame；导出 CSV=rows+unparse 配方；clone=useRecord+create 配方；Inferencer→脚手架 devtool（kit 的 guessers 对应物，open-code 哲学，后排）；向导=Stepper；translatable 字段=自定义字段块；日历/看板/树=自定义块等第二消费者（**注：react-admin 树组件是 EE 付费——我们的处置反而占优**）
- **C 类（持证拒签）**：**undo/乐观更新（明码标价：ra/kit 默认 undoable，fleet-ui 默认同步等待——重启条件：真实消费者需求，作为命令时机策略加回）**、SSR/元框架、后端适配器生态（kit 50+ providers、ra 同）、完整 i18n 语言包、provider 动物园/多租户 EE

**shadcn-admin-kit 专门对照（诚实版）**：kit v2.0（2026-09）= ra-core + shadcn/Base UI + React Router v7 + RHF + Zod，98+ 组件、guessers、saved-queries、undoable 默认、自带 SKILL.md、EE realtime/locks/soft-delete。fleet-ui 真实差异化收敛为上述五点超越；kit 优势如实：组件数量（98+ vs 首批 ~25）、十年数据层打磨、50+ data providers、undo/export/guessers 开箱。**诚实提醒**：react-admin 十年、refine 六年，npm 周下载 core 各 ~16 万/~9 万（ra-core ~12 万）；fleet-ui 成熟度只能靠垂直切片+双 console 迁移逐步挣得。

---

## 9. 包结构与分发

```
fleet-ui/                        # pnpm monorepo + catalog（单源版本）
├── packages/ui-kit                # @fleetly/fleet-ui-kit
│   ├── src/kernel/              # 契约+类型+查询/游标代数（零依赖，零 react import）
│   ├── src/schema/              # Effect Schema 工厂（依赖 effect ~4.0；公开面零 effect/schema 泄漏）
│   ├── src/adapters/            # http 管线(Effect 内部+runApi+401)/订阅引擎(零 React)/
│   │                            # evaluateQuery/clientCollection/transport/scoped/mock
│   └── src/react/               # 绑定 hooks + queryOptions 工厂（peer: TanStack 系；禁 import effect）
│   exports: ./kernel ./schema ./adapters ./react（+root 转发 ./react）
├── registry/{values,query,command,subscription,shell}/   # blocks 源 + registry.json 构建
├── apps/demo                    # Vite + TanStack Router + shadcn(Base UI) + Tailwind v4 + mockResource
└── docs/                        # design.md / AGENTS.md / SKILL.md / llms.txt
```

- **http 管线 API（定案，关闭 Agent 可用性 P0）**：

```ts
// /adapters —— 适配器作者的全部入口
createHttp({
  baseUrl?: string;                       // per-resource 亦可（well-known 裸端点/免鉴权出口）
  onUnauthorized?: () => void | Promise<void>;  // 401 handler 注册点（工厂参数，非全局 provider）
}): {
  get<T>(path, { params?, schema?, raw?, signal? }): Promise<T>;   // schema: Effect Schema（可省=不解码）
  post/put/del/sendRaw(...);                                        // raw=true → Blob 逃生口
  run: typeof runApi;                                               // 唯一边界
}
```

- **版本**：core 走 changesets + semver；**hooks 返回形状一经发布视为协议级稳定**（refine v4→v5 教训）；effect 锁 `~4.0`。
- **技术栈锁定**：React 19 / TS strict / pnpm / effect ~4.0 / @tanstack/react-router ^1.170 / react-query ^5.104 / react-table ^9 / react-form ^1（v2 alpha 监测条款）/ shadcn CLI v4 + Base UI 方言 + Tailwind v4 / vitest + Playwright / biome。

---

## 10. Agent 文档方案

- **SKILL.md**（TanStack Intent 格式，随包发布）：分两册——页面作者册（绑定 + 块 + 配方 + **反模式清单** + **幻觉诱饵对照表**）与适配器作者册（契约 + Effect 缝 + protojson 配方 + 401 管线）。
- **llms.txt**：库地图 + 概念词汇表 + 指向 SKILL.md。
- **AGENTS.md**（仓库根）：贡献/开发流程、质量门、layer-check、决策日志指针。
- demo 即活文档（每个配方一个可运行页面）。
- 反模式守卫测试：禁裸 `window.confirm`、禁手拼分页、禁绕过绑定直连 fetch、禁 useState 存列表状态、禁渲染期 navigate 等。

---

## 11. 质量门

1. `layer-check`：kernel 零依赖零 react import；单向依赖；**react 目录禁 import effect（目录级）**；/schema 公开面零 effect/schema 泄漏（声明扫描）。
2. vitest 单测：kernel 纯函数全覆盖（编解码往返、游标代数含 advance-prev 语义、错误归一矩阵、**失效矩阵含跨资源/scope 交运算/batch 键**、isRetryable、mockResource 契约）。
3. Playwright e2e：垂直切片端到端（URL 可分享/前进后退/双方言切换/四态/keepPreviousData）+ **a11y（axe + 键盘导航用例，DataTable/LogViewer 重点）**。
4. `tsc --noEmit` strict + publint/attw。
5. **bundle 预算**：/adapters 入口 gzip ≤ 35 kB；effect 漂移矩阵 CI。
6. **不引入**：词表冻结、一致性棘轮、截图基线类重治理。
7. **size-check 机械门**（2026-10-24 起，挂 `pnpm check`）：scripts/size-check.mjs——rolldown 打包 /adapters 入口（ESM+minify，peer 依赖外置、effect 计入）→ zlib gzip 计量，超 35 kB 非零退出。基线 20.4 kB。

---

## 12. 迁移路线（双 console）

**fleetly console**（TanStack Router 同栈，最顺）：
1. 底座接入：registry add + core 安装 + styles.css token 映射
2. 数据层：REST+protojson → Resource 适配器族（12 上下文分批；int64="string"）+ clientCollection + scoped(projectId) + useCan(platform_admin fail-closed，identity 走 loader)
3. 列表族练手 → 详情族（app 10 tab：URL tabs 修正 useState 不一致）→ 表单族（Dialog/DeploySheet——五源+hook 切换命令、specEdited 重播按 §5.4）
4. events/logs/wait → Subscription 线 + transport 适配器（票据/base64/终态分诊在此；wait 流=stalled+轮询组合）
5. overview/components → StatCard/MetricChart；terminal 自持收尾（保持一份实现，修掉现存两份分叉）

**torchwood console**（react-router-dom → TanStack Router 一并迁移）：
1. 路由迁移 + AppShell/Page 骨架
2. keyset 资源族 + 白名单 DSL predicate 适配器 + gateway 序列化 + 双通道作用域配方
3. 表单族（message-first 错误盒；OCC 先验证服务端判别再开 conflict 分支）
4. realtime ListenPanel → useSubscription（beforeReconnect=refresh→重订；restart=手动重连）
5. analytics → MetricChart 配方

**执行方式**：每批 = 子代理实现 + 质量门 + 行为等价验收。

---

## 13. 集中反模式清单（进 SKILL.md）

1. 禁给 DataTable/块传 url/resource——块不自带数据获取，只消费绑定输出。
2. 禁 useState 存分页/过滤/排序状态——URL 即真相（竞品训练反射是反的）。
3. 禁渲染期 navigate——setter 走事件/middleware（§2.1.1 写入契约）。
4. 禁 try/catch 或 onError 处理 rejected——它是返回值不是异常；失败才走 error 通道。
5. 禁帧到达就 invalidateQueries 当实时（refine liveMode 反射）——那是 invalidateOnFrame 组合，按需用。
6. 禁用 Zod 写 search schema（Effect Schema 单源）；禁给块用 Radix 路径（Base UI 方言）。
7. 禁页面层 catch 401 跳登录——全局闭环已接三通道。
8. 禁乐观更新/undo 后关窗——C 类拒签项，默认同步等待。
9. 禁绕过绑定直连 fetch（Resource/http 管线之外）。
10. 禁造 CustomPage/页面登记机制——自定义页面就是普通文件路由。
11. 禁把 Resource 当 react-admin 的 `<Resource>`（路由注册）——纯数据契约，路由自己写。
12. 禁裸 `window.confirm` / 原生 dialog / 手拼分页条（用 ConfirmDialog / Pagination 块）。

---

## 14. 幻觉诱饵对照表（进 SKILL.md）

| 危险对（训练数据习惯 → 正确姿势）                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| react-admin/refine `<Resource name list create>`（路由注册）→ fleet Resource = 纯数据契约，路由自己写                                                  |
| dataProvider `getList({pagination:{page,perPage},sort,filter})` → CollectionQuery `{predicate, order, window}`                                         |
| **refine `useSubscription(channel, params, onEvent)`（帧→失效回调）→ fleet `useSubscription(descriptor)` 返回帧缓冲+状态机（完全同名不同义——最危险）** |
| refine useTable/useList（tableProps、pagination.current）→ useCollection 返回 list 句柄（window.size）                                                 |
| refine useForm（record 加载+保存一体）→ useCommandForm 只管命令提交，initialValues 另配 useRecord                                                      |
| Zod（validateSearch 训练默认）→ Effect Schema（经 toSearchSchema 包装）                                                                                |
| Radix 系 shadcn → Base UI 方言                                                                                                                         |
| react-admin useNotify / notificationProvider → 无内置 toast，onSettled + sonner                                                                        |
| Relay pageInfo/endCursor → Segment{rows, total?, nextCursor?}                                                                                          |

---

## 附录 A：决策日志（十轮迭代 + 审查裁决）

| #   | 裁决                                                                                                  | 依据                         |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | 不借用旧项目概念设计，从零推演                                                                        | 旧项目五死因                 |
| 2   | 分页降级为 window 字段、客户端求值为派生适配器                                                        | 求值策略非元概念             |
| 3   | Effect 采纳 L1（缝隙派）                                                                              | 三缝收益 vs 页面零接触边界   |
| 4   | View 溶解为 CollectionQuery；Source→Resource；Stream→Subscription                                     | 范畴错误修正 + 语域统一      |
| 5   | 双 console 核对 8 修正                                                                                | 真实消费者证据               |
| 6   | UI 五族 + 判据 + 配方非原型                                                                           | 双 console 组件收敛实证      |
| 7   | 无 CustomPage                                                                                         | 框架不拥有页面类型系统       |
| 8   | 竞品 A 类补齐                                                                                         | 交叉审核                     |
| 9   | Resource 三原语可选；失败/结果两分；invalidates 声明；绑定原语语域                                    | 概念严格审计四修复           |
| 10  | 设计文档先行 + 多视角审查 + 交叉审核                                                                  | 本流程                       |
| 11  | 网络断层=typed failure 非 defect；not-found/forbidden 经 treatAs 裁决                                 | 概念审计×Effect 审查交叉命中 |
| 12  | 命令/订阅泛型逐键推断；ResourceName branded；getId 可选；订阅允许裸 Transport                         | DX×概念审计交叉命中          |
| 13  | QueryWindow/ResourceScope 改名；EventFeed 块名豁免记录                                                | 撞名政策自查                 |
| 14  | search 写入契约（函数式/push-replace 纪律/职责单一归属）；"URL+默认值即真相"                          | Router 三暗规则              |
| 15  | rejected→onSubmitAsync 返回（弃 setErrorMap）；onSettled+sonner；reveal 不进缓存                      | Form v1/v2 实测              |
| 16  | 订阅引擎挪 /adapters（react 目录级禁 effect）；FrameSource 终态分诊；stalled 态；beforeReconnect 钩子 | 可实现性×Effect 交叉命中     |
| 17  | leaderboards 定性修正；advance(window,segment,dir)；int64 双策略；raw-response/FormData 逃生口        | 源码对账                     |
| 18  | 竞品 §8 重写（乐观更新矛盾/liveMode manual 校正/kit 诚实对照/useCollectionInfinite 升 A 类）          | 竞品审查                     |
| 19  | effect ~4.0 tilde + 漂移矩阵 + bundle 预算；a11y 质量门                                               | Effect v4 unstable 事实      |
| 20  | 集中反模式清单 + 幻觉诱饵表                                                                           | Agent 可用性审查             |

## 附录 B：开放问题（draft-2 已全部裁决关闭）

- **Q1 谓词/窗口序列化**：✅ 已定案（§2.1.1：`q` / `filter=field:op:value` 重复键 / `sort=field:dir` / `cursor` / `page` / `size`）。
- **Q2 load-more**：✅ `useCollectionInfinite`（A 类升格；Segment.nextCursor 与 getNextPageParam 对齐；双向 prev 引擎原生）。
- **Q3 prev 语义**：✅ advance(window, segment, dir) 返回 null = 不可算（keyset/leaderboards 走浏览器历史；offset 与客户端求值可算）。
- **Q4 list 句柄**：✅ 块自建表 + list 稳定句柄协议（引用仅随 key/data/状态变；rows 直出缓存享结构共享；setter 全 stable 函数式 navigate）。
- **Q5 scope 类型化**：✅ `ResourceScope` 松散 Record（不进 Resource 泛型——类型噪音大于收益；branded name 已保失效安全，附录 A#9 的"scope 非框架轴"维持）。
- **Q6 表单映射**：✅ §5.4（onSubmitAsync 返回制；onSettled；重播；v2 监测）。
- **Q7 FrameSource**：✅ AsyncIterable + closeReason 终态分诊 + AbortError 区分（§2.3）。
- **Q8 registry 对齐**：块依赖 `@fleetly/fleet-ui-kit` 的 semver range 写进 registry item 的 dependencies（shadcn CLI 原生支持 npm range）。
- **Q9 messages 通道**：MessagesProvider（context）+ 块级 props 覆盖（props > context > 内置英文缺省）——形状简单，实现期定稿即可，不再是阻塞项。
- **Q10 mock 能力边界**：mockResource 需支持——延迟/失败注入（测试三态与闭环）、keyset/offset 双方言模拟（demo）、命令结果分支注入（rejected/conflict/ok+reveal）。实现期定稿验收。

## 附录 C：A2/A3 审查与裁决记录（摘要）

六个只读审查视角（概念审计 / React·TanStack DX / 双 Console 可实现性 / 竞品对标 / Agent 可用性 / Effect 集成），合计约 130 条发现（P0×13 / P1×42 / P2×75）。裁决结果：**采纳并修订约 110 条**（含全部 P0），合并/延后约 15 条（多为实现期细节，已并入附录 B 关闭项），拒签约 5 条（例如"EventFeed 改名 FrameFeed"——裁决保留 EventFeed 并修订政策为呈现层豁免记录；"kernel 用 _tag 替 kind"——裁决 kind 站边界、_tag 留缝里）。关键裁决已编入正文并在附录 A #11–#20 记录。交叉验证显著：网络断层通道矛盾（概念×Effect 双命中）、泛型擦除（概念×DX 双命中）、订阅引擎位置（可实现性×Effect 双命中）——独立审查者对同一要害的收敛是发现真实性的强证据。
