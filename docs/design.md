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
3. **分发双通道**——无头核心 `@lynx-go/ui-kit` 发 npm（semver + changesets）；UI 块走 shadcn registry 拷贝制（open code，归消费方所有）。
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

**选型 = recharts（vendored shadcn chart.tsx 基元 + 块直用 recharts 原语）**。取证：两 console 现行同库 recharts ^3.10.1（fleetly shadcn 封装 + torchwood 裸用）；密度上限 240 点/序列 × ≤10 序列/图（fleetly 窗宽定死 240 桶）——uPlot 的百万点性能溢价无落点，且 canvas 渲染丢 CSS 变量主题化、tooltip/图例全要自建；自绘 SVG 需重建时间轴 scale/跟随 tooltip/图例，为省一个消费者已有的依赖重造轮子。**分发影响**：registry 拷贝制下 recharts 落消费方——registry.json item `dependencies` 声明（registry-build 扫描块裸导入自动追加）+ root devDeps 供 demo；不进 @lynx-go/ui-kit core，/adapters 预算门不受影响。

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
├── packages/ui-kit                # @lynx-go/ui-kit
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

### 12.1 fleetly 试点切片：实现期裁决（2026-10-24，垂直切片 = apps 列表页）

按上节 fleetly 路线 1–4 步做的可验收切片（console 仓内），裁决先于实现记录如下：

1. **分发 = tarball vendored**：@lynx-go/ui-kit 未发布，试点经 `pnpm pack` 产 tarball 落消费方仓内 `console/vendor/`，`file:` 协议安装。否决 link/相对路径目录依赖——fleetly 的 `console:verify` 零漂移门禁在 CI 跑 install+build+test，相对路径在无 fleet-ui checkout 的环境必炸；tarball 进仓与该仓 dist 提交文化一致。代价：版本升级 = 重新 pack+commit 双仓手工同步（devtool 痛点 #1）。
2. **int64 = "string"**：fleetly 生成链（protojson→swagger→openapi-typescript）已把 int64/uint64 钉死为 string，§5.2 双策略取 string 侧，无新决策空间。
3. **URL 兼容 = 纯增量**：fleetly console 列表页现状**零 URL 参数**（过滤/分页全在 useState）——`q/page/size/sort` 是新键，无存量参数需要兼容解码或 redirect；§2.1.1 键名定案与存量 URL 的边界在本仓 = 空集。既有 `?tab=` 等参数不受影响。
4. **token 方言 = 类级重写（拷贝适配）**：registry 块说 demo 的自研 token 方言（`text-muted/bg-panel/border-line/text-fg`…），消费方是 shadcn 全量 token。Tailwind v4 里 `--color-muted` 已被消费方 `bg-muted` 占用——**token 覆盖不可行，只能类名重写**（映射：`text-muted→text-muted-foreground`、`bg-panel→bg-card`、`bg-panel-2→bg-muted/50`、`border-line→border-border`、`divide-line→divide-border`、`text-fg→text-foreground`、`text-err→text-[var(--status-danger)]`）。这是拷贝制的机械适配步骤，映射表是 devtool 的第一个确定性需求。
5. **基元方言缺口本地补**：块基于 demo 基元（Base UI 方言）；消费方 Radix 方言下 Button/Input/Card/Skeleton 名字兼容可直接用，唯一 compound 不匹配是 Select（demo=原生 select 包装、console=Radix compound）——在消费方 `components/fleet/ui/` 落一个原生 select 桥供块 import，不改块源。
6. **四态文案自持**：块内 ErrorState 是 kind 分支文案（诚实、分状态），消费方另有 describeError 单源契约——拷贝制下消费方拥有副本可自持，试点保持块原样；四态节点的 override 槽（自定义 error/empty 节点）列为块 API 后续议题。
7. **消费方守卫面天然不咬**：console 的反模式守卫（console.ui.antipattern.test.ts）扫描根为 domain/lib/features/hooks/routes/pages——`components/fleet/**` 与 `components/ui/**` 同为 vendored 层在面外；rule ⑦ 的 `@/components/ui` 精确匹配不咬 `@/components/ui/button` 子路径。无豁免改动。

**痛点清单（devtool 需求雏形，实施后终版）**：
① tarball 双仓手工同步：改 kit → pack → 拷 vendor → 删 store 目录重装 → 清 vite 缓存重启 dev（回路约 1 分钟，vite 不感知 file: tarball 内容变更——须 rm node_modules/.vite）；
② token 方言类名映射表人工执行（§12.1-4，5 个块约 10 处类名）；
③ 基元方言差异人工判别（Select compound 不匹配需本地桥；Button/Input/Card/Skeleton 名字兼容属运气）；
④ `@/lib/utils` cn 别名 shim 需手工创建（消费方用 `cn` npm 包）；
⑤ routeTree.gen.ts 加 validateSearch 后须重跑 `tsr generate` 才过 typecheck；
⑥ 块从 `@tanstack/table-core` 导入 RowData——消费方只装了 react-table，需改主入口导入（registry 上游可直接修）；
⑦ 块自带页壳（mx-auto max-w-5xl p-6）与页内 header 同消费方"壳/页头单源"架构法冲突——拷贝需结构剥离（上游改进项：块 shell-agnostic 化）；
⑧ kit 发布 .ts 源码 = 消费方 noUnusedLocals/noUnusedParameters 严格度穿透检查 kit 源（见下 kit 修复 #1）。

**试点挖出的 kit 真 bug（当批已修 + 补测）**：
1. `CommandDescriptor<Input, Payload, ID>` 的 ID 类型参数体内未使用——消费方严格 flags 下 TS6133 直接阻断安装（demo 自身 tsconfig 较松未暴露）。修复：`__id?: ID` 类型线程锚（运行时无形状）。
2. **`from` 契约文档错误 + navigate 语义分裂**：文档写 `Route.fullPath`，但 TanStack Router 的 `useSearch({from})` 按**路由 id** 匹配（pathless 布局 `_shell` 进 id 不进 path），`navigate({to:"."})` 又把 from 当**路径模板**解析——demo 顶层路由 id==path 掩盖了两者分裂；fleetly 嵌套+带参+pathless 路由下，fullPath 让 useSearch 炸 invariant、Route.id 让 navigate 产出 `/_shell/...` 假路径。修复：契约改为 **`Route.id`**（useSearch 用），navigate 去掉 from（`.` 对当前 match 真实路径解析，全形态正确）。
3. **`patch({predicate: null})` 清除残留**：补丁不产 `q: undefined` 键，函数式 search `{...prev, ...patch}` 展开时旧 q 存活——FilterBar Clear 后 URL 残留 `?q=`。修复：清除时显式 `q/filter = undefined` + 单测锁行为（84 单测）。

**行为对照验收（console 无 e2e 基建，stub API + 浏览器实测清单，2026-10-24 全过）**：
① 列表渲染：25 apps / 首页 20 行 / 页头描述带项目名 ✓；② 快筛 `q=web-1` 进 URL、命中 10 行（web-10..19，name/id 字段集与旧页 fieldsOf 等价）✓；③ Clear 清 q 回 25 行 ✓；④ Next → `?size=20&page=2` push、Showing 21–25、后退回第 1 页（历史=分页栈）✓；⑤ 表头排序 asc/desc 进 URL、行序正确（web-01 ↔ web-25）✓；⑥ 深链 `q+sort+page+size` 重载全还原 ✓；⑦ 过滤空态与源空态两套文案 ✓；⑧ 行点击进 app 详情、后退回列表 ✓；⑨ 错误态（分状态诚实文案 + Retry 一等按钮；stub 停机→恢复实测）✓；⑩ 视觉：token 映射后与 console 暗色主题融合（截图核验：标题/表格/徽章/等宽 id/分页条无对比度问题）。**门禁**：console 153 测试（+6 新：protojson 收敛/空 scope/Bearer 头/错误信封/编解码往返/清除补丁）、tsc、build（dist 再生成）、console:verify 零漂移口径全绿。**新增 URL 能力（行为增量，非等价破坏）**：过滤/分页/排序/页大小全部可分享、可前进后退——旧页这四者全是 useState 本地态。

**§12 路线第 5 步补记：metrics 页对照直迁（2026-10-24 完成）**：MetricChart 块拷入 console（该块零 kit import——recharts + shadcn chart 基元 + cn，token 映射同 §12.1-4 表）；`features/metrics/metric-chart.tsx` 重写为**页面投影 + 同名薄壳**——`toMetricSeries`（key=`s{下标}`、label 经 seriesIdentity 按全集频次判别同名副本）+ `serverCapOf`（truncated/series_total → 块 serverCap props），**seriesIdentity 留 console 侧**（§6.1 裁决兑现：base/replica 是业务词汇）；三个调用点（工作台/app metrics tab/databases metrics）props 零改动——投影薄壳是 v1 形 props 与块 props 之间的诚实边界。旧 console 的 10 条数据语义测试锚（零值缺省/时间轴对齐/脏点/s{index} 唯一/身份判别/活跃排序/截断披露）完整迁移到 `toMetricSeries ∘ buildMetricRows` 真实执行路径——**vendored 块的单测覆盖家在消费方**（registry 块不进 ui-kit 包，fleet-ui 侧只有 e2e 覆盖），此约定成文。行为差异记录：图内重复的 ChartLegend（旧实现渲染了两份图例）随迁移消去，"+N more" 文案由业务句（"stopped replicas…queryable in the workbench"）改为块的通用句——实体文案归页面/消费方的边界在此反向生效（块不认业务词；消费方如需业务句可自持薄壳覆写，本批接受通用句）。浏览器实测（stub 15 序列 fixture）：活跃窗排序/双副本判别尾/全零序列 0% 末值（W-B1 锚）/10 条渲染上限/+N more/服务端截断披露全部呈现。

**分发形态演进（2026-10-24，npm 首发后）**：裁决 1 的 vendored tarball 是未发布期的过渡形态——@lynx-go/ui-kit 0.1.1 公开发布后，console 已切 registry 依赖 `^0.1.1`（vendor/ 目录删除，CI install 不再依赖双仓同步，痛点 #1 随之消解）。发版纪律成文：**必须 `pnpm publish`**——`npm publish` 不解析 pnpm `catalog:` 协议，首发 0.1.0 依赖泄漏 `"effect": "catalog:default"` 不可安装（已 deprecate，净房 install 实证 EUNSUPPORTEDPROTOCOL）；publint + 净房 `npm install` 冒烟是发版门。可见性裁决：组织无付费计划，`publishConfig.access: public`（源码分发模型下 npm 包即源码公开，接受）。

### 12.2 torchwood 批 A：路由换轨 + keyset 切片——实现期裁决（2026-10-24，取证先行）

torchwood console 取证要点（裁决依据）：react-router-dom **v7** 集中式路由表（App.tsx 60+ 路由，React.lazy + RequireAuth/RequireRole 组件守卫 + RouteErrorBoundary key=pathname 技巧）；axios 管线（HttpOnly cookie 会话 + 401 单飞刷新 + `expired=1` 断路器 + **X-Torchwood-Project header 全局注入**（localStorage 单源）+ 全局错误 toast）；keyset 契约 = `Page<T>{rows, nextPageToken}` 空页停 token、换向回第一页（游标与方向耦合）、gateway 枚举名 `SORT_ORDER_ASC/DESC`、repeated 参数需 `key=a&key=b` 串行化；**token 栈在 useState（useServerPaging）——游标不进 URL，深链中栈不可用**（§2.1.1 已成文的边界即此现状）；Tailwind v3 + shadcn classic token（`text-muted-foreground/bg-card/border-border` 全有——token 映射对 torchwood 近恒等）；测试 74 条（vitest + testing-library，10 文件用 MemoryRouter）；无 e2e；dist 不进 git（仅 .gitkeep）。

1. **路由迁移 = 一次性全量换轨 + 过渡兼容层**：TanStack Router **code-based 集中路由表**（src/router.ts 镜像现 App.tsx 表——路由路径形态零变化、lazy 经 `route.lazy()`），不做 file-based 改造（60+ 页文件搬家是纯搬运，收益归后续批）。页面层经 `src/router/compat.tsx` 过渡兼容层（Link/NavLink/useNavigate/useParams/useSearchParams/Outlet/Navigate/useLocation 的 TanStack 薄映射），页面文件只改 import 行（react-router-dom → @/router/compat）——机械可审、低风险；**react-router-dom 依赖移除 + eslint no-restricted-imports 禁回**（守卫执法）。后续批次随各页 fleet-ui 化逐页退 compat（页内改 Route.useParams/useSearch 原生形态），compat 层清空即退役——过渡层有始有终，不是永久拐杖。
2. **守卫与错误边界映射**：RequireAuth/RequireRole 组件包裹 → TanStack `beforeLoad`（auth context + role 判定 + `throw redirect`）；RouteErrorBoundary 的 key=pathname 重置技巧 → TanStack 原生每路由 `errorComponent`（消费方 ErrorBoundary 组件保留，壳换挂法）。G8-1 路由级权限语义不变。
3. **数据层切片（audit-logs 先行）**：适配器**复用 axios 管线**（拦截器栈是 torchwood 资产：cookie 刷新/断路器/scope header/toast——kit createHttp 的 onUnauthorized 闭环暂不接入，**接入是后续收敛批**，记挂账）；collection 适配 = `CollectionQuery.window.cursor → page_token`、`order.dir → SORT_ORDER_*`、`predicate → 白名单过滤参数`（action/status/actor_id/resource_id/created_after/created_before/include_platform/all_projects——§2.1.1 `filter=field:op:value` 与存量无冲突：该页现状过滤全在 useState 不进 URL）；`Page<T> → Segment{rows, nextCursor}`（next_page_token 缺席 = 到底；meta.total_count 存在但 keyset 语义不显示——leaderboards 型 total 并存的另一个实证，KeysetPagination 不吃它）。**游标进 URL 是新能力**（现状 token 栈组件态）。
4. **int64/version = number**（§5.2 number 侧——version 比较是 torchwood 动机，本切片无 version 面）。
5. **分发 = npm ^0.1.1**（已发布；pnpm 11.20 同样有 minimumReleaseAge 冷却，需 workspace exclude）。
6. **作用域不接 scoped()**：X-Torchwood-Project header 是 torchwood 作用域单源（axios 拦截器全局注入 + useProjectScopeSync 双通道防乒乓），试点切片保持 header 单源——kit `scoped()` 的 ctx 注入随表单族批次评估（双头作用域是乒乓源）。
7. **切片页面 = audit-logs**（useServerPaging 注释自指的"先例页"：七过滤 + 换向 + 页大小 + keyset）：fleet 块拷贝（ListPage/DataTable/KeysetPagination/states——token 近恒等映射，Select 复用 fleetly 同款原生 select 桥）；过滤 UI 保留页面自有形态（datetime-local/复选不在 FilterBar 面），谓词经 `filter=` 进 URL。

**批 A 不做（挂账后续批）**：表单族/OCC（B 批）、ListenPanel → useSubscription（C 批）、analytics → MetricChart（D 批）、kit http 管线收敛、file-based 路由改造、compat 全退。

**批 A 实现期偏离回写（2026-10-24 落地，两批提交：路由换轨 + keyset 切片；门禁 90/90 绿 + 浏览器对照通过）**：

- **裁决 2 修订——守卫保留组件形态**：auth 是 React context（AuthProvider + useQuery），`beforeLoad` 无 React 上下文可用；RequireAuth/RequireRole 经 `guarded()/roleGuarded()` 工厂挂 `component`，错误兜底用原生 `errorComponent`（RouteErrorBoundary 组件保留、壳换挂法）。beforeLoad 化随 compat 退场批次做。lazy 同理保留 React.lazy + 根级 Suspense（未用 route.lazy()——裁决 1 的实现修订）。
- **裁决 3 修订——Segment.total 显示而非丢弃**：audit-logs 网关附带 total_count；块侧按"有则显示总数、无则仅本页行数"降级（其余 torchwood 列表端点无 total）。比"一律不显示"更贴近存量页语义（旧页显示 共 N 条）。
- **裁决 7 修订——Select 保留 radix**：torchwood token 近恒等（text-muted-foreground 等全有），KeysetPagination 的页大小切换直接用本仓 radix Select（未拷 fleetly 原生 select 桥）；ListPage 拷贝去页头（fleetly 先例——页头归 PageHeader）。
- **keyset 适配落地形态**（src/fleet/auditLogs.ts）：axios 失败在消费方适配器收敛为 ApiError 封闭集（fleet/errors.ts 的 toApiError——拦截器资产保留，kit createHttp 后续收敛批接入）；scope 三态经伪字段 `filter=scope:eq:…` 表达、适配器展开布尔参数；datetime 过滤 URL 存**绝对时刻**（页面边界按管理员时区做墙钟↔绝对换算，跨时区链接同窗）；schema **不设 defaultOrder**——排序三态 none/asc/desc 要能落回服务端默认序，defaultOrder 会把"无排序"钉死在 desc。
- **TanStack 方言实测**（compat 层与测试已消化）：splat 是 `/$` 不是 `/*`（TestRouter 带 normalizeTestPath 双方言归一）；RouterProvider 首提交异步——jsdom 测试渲染后需 `await act(async () => {})` 冲刷；useOutletContext/useParams 非其导出——前者经 React context 自实现，后者经 useRouterState 合并 matches。
- **URL 数组方言**：TanStack 默认序列化把数组值 JSON 编码（`filter=%5B%22action%3Aeq%3AX%22%5D`）——与默认解析往返自洽，消费方断言应读解析后的 search 对象而非原始 query 串。

### 12.3 torchwood 批 B：命令族/表单族——api-keys 切片裁决（2026-10-25，取证先行）

取证要点：torchwood console **无表单库**（全手写 useState 受控表单）；命令流 = useMutation + queryClient.invalidateQueries(["api-keys", …]) + sonner toast（axios 拦截器全局错误 toast，`__skipToast` 可豁免）；api-keys 三页 = 列表（行删/批量删/enabled 过滤）+ 新建（name + scope 词表勾选/通配/手输 + **secret 一次性显示**）+ 详情（编辑对话框 diff 提交 + 轮换双 Key 引导）；**无 version 面**。OCC 真实面在 databases documents（version 必填）与 runtime-vars（etag）。

1. **表单栈 = 引入 TanStack Form**（torchwood 首个表单库，kit peer ≥1.30）：新表单走 useCommandForm/裸 TanStack Form + Form/Fields 块；存量 useState 表单并存，逐页换轨（与批 A compat 层同节奏——有始有终）。
2. **命令资源化**（api-keys 首个 commands 资源）：`create/update/remove` 三命令挂 defineResource；结果两分映射 = HTTP 400→`rejected{code,message}`（gateway 错误体 {error:{code,message}}；**fieldErrors 形状未实证，先不映射**——挂账 B2）、409→`conflict`、其余经批 A 的 toApiError 收敛缝 throw ApiError；delete 已删→幂等 ok（treatAs not-found）。
3. **toast 单源 = onSettled**：命令调用一律 `__skipToast: true`（拦截器全局 toast 让位）——ok → toast.success（消费方文案）；结果分支（rejected/conflict）→ Form 块结果盒（message-first，不 toast）；失败（ApiError）→ toast.error(describeApiError)。双 toast 是接入反模式，裁决在先。
4. **失效桥接（过渡期双轨）**：kit invalidationPredicate 有 isFleetKey 守卫（只失效 "collection/record/batch" 前缀键）——存量 `["api-keys", …]` 键在 onSettled 手动 invalidate（页面知道两个世界，桥在页面）。api-keys **列表骨架不动**（ResourceListPage + useServerPaging + 页内搜索/批量选择）：kit DataTable 行选择尚无（v9 atoms 挂账），列表换轨等选择支持。
5. **reveal 概念正名**：create 的 secret 一次性显示 = useCommandForm.reveal（ok payload、卸载即弃、不进 Query 缓存）——API key secret 是 reveal 的原生案例（kit §5.4 预言兑现）。
6. **proto3 optional diff 语义归 descriptor**：update 表单值 = 展示形（含 datetime-local），descriptor 工厂闭包原实体快照（`editApiKeyDescriptor(key)`），run 内做字段 diff 只传变更；tz 换算在**字段边界**（字段值存 ISO，input 渲染/写入时按管理员时区墙钟↔绝对换算）——descriptor 无时区依赖，URL/表单值可分享。
7. **块拷贝范围 = Form/TextField/SelectField**（token 映射同批 A 表）；**ConfirmDialog/DeleteButton 不拷**：torchwood 有 radix confirm 既有约定（RowDeleteButton/DeleteButton/BulkDeleteButton），命令接线在 onConfirm，确认壳留存量——块的 minimal overlay 形态是 demo 方言。
8. **批量删除与轮换保持直调**：批量 = N 命令聚合（Promise.allSettled 汇总文案），非 useCommand 面；轮换 = useCommand×2（create + expireOld），双 Key 引导 UI 不变。
9. **OCC 挂账 B2**：本切片无 version 面；databases documents（version 必填）或 runtime-vars（etag）做 B2 切片时一并裁决 fieldErrors 形状与 conflict 分支的真实路径。

**批 B 不做（挂账）**：列表骨架 fleet 化（等行选择）、ListenPanel → useSubscription（C 批）、analytics → MetricChart（D 批）、kit http 管线收敛、compat 逐页退场、OCC（B2）。

**批 B 实现期回写（2026-10-25 落地，门禁 105/105 + 浏览器对照通过）**：

- **Resource.commands 可选类型面**：消费方按 demo 先例 `commands!` + 模块级提升句柄（createApiKeyCommand/removeApiKeyCommand）；treatAs 字面量需 `as const`（status: "ok" 否则推断 string）。
- **TanStack Form 方言三则**：① required 校验器需同时挂 onChange（即时反馈）+ onSubmit（兜住"从未输入直接提交"），双注册会在 meta.errors 产生重复条目——FieldErrors 渲染去重；② 跨字段联动（wildcard 禁用词表勾选）必须 form.Subscribe——目标字段子树独立订阅，直读 form.state.values 在对方翻转时不重渲染；③ FormPageWrapper 类"onSubmit 形外壳 + 自渲染 footer"与 Form 内芯互斥（内芯持有 submit），整页表单换壳不换芯。
- **radix Dialog 退出动画残留**：关闭后 data-state=closed 的 Presence 可长期滞留 DOM（等 exit animationend）——既有壳行为非切片引入，elementFromPoint 证不挡交互；jsdom 断言用 queryByRole 即可（radix 在 jsdom 立即卸载）。
- **TanStack 测试方言补一条（切片复核时发现）**：命令 onSettled 内 `navigate` 的目标路由未注册进 TestRouter harness 时，not-found rejection 的落点随并行时序漂移——单文件稳定、全套 4 轮 1 次失败，每轮均有 notFoundError stderr 佐证；harness 须注册导航目标路由（torchwood bf34dc99 修复，修后 stderr 归零、全套 2 轮 + 单文件 3 轮 105/105）。
- **浏览器实证**：新建 reveal 一次性 secret、编辑 diff（仅传 name）+ 桥接失效刷新、删除后存量列表实时更新（手动桥生效）。

### 12.4 torchwood 批 C：订阅族——ListenPanel 切片裁决（2026-10-25，取证先行）

取证要点：torchwood `/v1/realtime` 是**握手式 WebSocket**（非 fetch 流）——cookie 鉴权（HttpOnly TORCHWOOD_session_console，无 access_token 面），open 后 `hello{project_id}` → `hello_ok{connection_id}` → `subscribe{id:"c1", channel}`，服务端 30s ping/客户端 pong，事件帧 `event{channel, payload}`；断线（15m 到期 close 1008 token_expired 或任意 onclose）→ 先 `/v1/console/auth` refresh 续 cookie → 重开重订（**不补历史**），refresh 失败 → disconnected + 「已断开，点击重连」手动重连；现状**无退避重试、无游标/续订语义、无服务端终态**（流永续）。ListenPanel = CollectionLayout 的 listen tab，Outlet context 给 dbId/collId，事件表 100 条封顶。kit 侧对照：`Transport.beforeReconnect` 与 `SubscriptionHandle.restart` 的注释**明写 torchwood realtime 是预定落点**（kernel types.ts「先 refresh 再重订」/ 引擎「torchwood 手动重连」）——映射是契约设计时预对的。

1. **transport = 消费方自建薄 wsTransport**（非 ndjson/sse 复用）：握手协议与双向 ping/pong 无法落 fetch 流族，正中 kernel「帧方言归消费方适配器」的分工。分层对齐批 A：`api/realtime.ts` 收敛为纯协议件（URL、ListenWebSocket 注入口、帧构造/解析），kit 面 `Transport<EventFrame>` + descriptor 落 `src/fleet/realtime.ts`；现 `startCollectionListener`（自带重连环）被引擎整体取代——删除，重连/退避/refresh 编排一律归引擎，消费方不再手写监听状态机。
2. **重连语义映射**：一切非用户 onclose → 迭代器抛 `{kind:"network"}`（可重试中断）→ 引擎退避 → `beforeReconnect = refreshSession` → 重开重订；退避预算耗尽 → stalled。close 1008 token_expired **不映射 auth 终态**——首遇即终态会杀死 15m 正常续期路径（refresh 只活在 beforeReconnect，终态分诊先于它）。refresh 失败不阻断重订（引擎既定语义）：死会话多跑 ≤N 轮退避后 stalled，UX 等价（同落「已断开+手动重连」），多付出有界探测；顺带换来瞬时 refresh 抖动不杀监听。手动重连 = `sub.restart()`（先开后刷，会话已死时多一拍退避）——kit 注释预定语义，接受。
3. **退避与缓冲**：`backoffMs = [500,1000,2000,4000]`（试听面板量级，~7.5s 到 stalled）；`buffer = 100`（= 现 MAX_EVENTS，环形缓冲丢最旧即现状 slice 语义）。
4. **descriptor = 裸 SubscriptionDescriptor**（demo eventsStream 同款先例，不挂 Resource——collections 资源化不在本批）：`params={dbId, collId}`、`scope={projectId}`（hello 的 project 绑定就是作用域概念本体）、policy 声明在 descriptor（运行时判别）；`cursor: null`（活尾即开）、无 getCursor（无续订语义，重连即活尾重订）。projectId 未就绪（null）→ open 返回待命迭代器（首 next() 挂起至 abort），状态停留「连接中」——对齐现状 `if (!projectId) return` 的守卫。
5. **帧方言**：`ListenEvent → EventFrame{channel, payload, at, seq}`——`at`=到达时刻（transport 内 new Date()，同现状）；`seq`=transport 闭包内**跨重连单调递增**的到达序（transport 实例跨引擎重试复用），作 EventFeed 的 getKey——无 backlog 不补历史，去重即到达恒等。
6. **块拷贝 = EventFeed 单块**（LogViewer 不拷——日志族是 fleetly 面，torchwood 试听是事件面）：token 映射同批 A 表 + **warn→amber 系**（torchwood 无 warn token，`border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400` 是仓库既有 warn 惯例）；demo Badge `tone` → shadcn `variant`+className（ok→default、err→destructive、warn→secondary+amber 字色）；**文案中文化**（批 B form.tsx 先例，vendored 头注明差异）。页面投影：render 槽 = 时间（formatTimeOnly+管理员时区）+ 事件名（payload.event）+ payload 摘要（120 字截断）；stalled 黄条的 resyncAction 槽 = 「已断开，点击重连」按钮（onClick=sub.restart）。
7. **UI 形变接受**（批 A audit-logs 整页换 DataTable 同款先例）：Table 三列 → EventFeed 列表行；页级小页头（Radio 图标+「实时事件」+状态徽章）让位块自带页头（状态徽章+计数）；状态文案映射 live=已连接 / reconnecting=连接中… / stalled=已断开。**live 语义偏差知情接受**：引擎 live = open() 返回即置（ndjson 同款——迭代已启动≠握手完成），WS 握手窗口徽章短暂超前、黑洞网络下 live 持续到 TCP 超时——连接失败随即回 reconnecting/退避。暂停能力（块自带 paused 指示灯）本批不接页面按钮——现状无此交互，保持等价。
8. **测试换轨**：MockWebSocket harness（stubGlobal）+ vi.mock api/auth 保留；行为锚三条不丢：① hello 绑 project_id（无 access_token）→ hello_ok 后订阅频道 → 事件呈现 → ping/pong；② close 1008 → refreshSession 调用 → 新 WS 重 hello+重订；③ refresh 持续失败 → 多轮退避后 stalled「已断开」→ 点击重连 → restart → 恢复。**真实计时器**（Effect sleep 与 vitest fake timers 不友好），首档 500ms 在 waitFor 预算内。stub 扩手写 RFC6455 最小 ws 服务端（`/v1/realtime` 握手+事件推送+1008 关闭控制端点）供浏览器对照。

**批 C 不做（挂账）**：fleetly 订阅族（events/logs/wait 票据方言是另一套取证）、暂停/恢复交互接入（块能力已在）、analytics → MetricChart（D 批）、列表骨架 fleet 化、kit http 管线收敛、compat 逐页退场、OCC（B2）。

**批 C 实现期回写（2026-10-25 落地，门禁 105/105 + 浏览器对照通过）**：

- **closeReason 恒 "transport" 落成常量属性**：本方言无服务端终态（流永续，一切收流皆中断）——transport 的 closeReason 不再需要 let+getter 形态（ndjson/sse 因 isEnded/endEvent 会改写才用 getter），eslint prefer-const 顺水推舟。消费方 transport 的两种写法（恒值/可变）自此有对照样例。
- **待命迭代器的 TS 方言**：projectId null 的"待命至 abort"分支 await 一个只 reject 的 Promise——TS 不因此收窄 null，需在 await 后补不可达 `return` 满足控制流分析（运行时死码）。
- **vitest 计时方言**：stalled 全路径要走完 4 档真实退避（250+500+1000+2000=3.75s，Effect sleep 与 fake timers 不友好只能真实计时）——`it(name, { timeout: 20000 }, fn)` 选项形态（describe 第三参超时在 vitest 4 不可用）；测试驱动"死会话"循环 = 每个新 MockWebSocket 实例到达后手动 serverClose（mock 不会自行关闭，真实服务端才会）。
- **引擎 refresh 语义实证**：refresh 按重试次数调用（每档退避后一次，beforeReconnect 落点），非按 close 次数——4 档退避 = 4 次 refresh + 5 个连接后 stalled；restart 立即重开不先 refresh（会话已死时多一拍退避再进 refresh 路径）。
- **浏览器对照（stub 手写 RFC6455 最小服务端**：握手 sha1+掩码帧解析+close 帧状态码；控制端点 /stub/ws/{state,emit,expire}；vite 代理 `/v1` 需对象形态 + `ws: true` 才代理 WebSocket）：① hello 绑 proj-1 + 订阅 databases.app.collections.posts（服务端 state 佐证）；② 两条事件到达——最新在上、到达时刻按管理员时区（Asia/Shanghai）渲染、payload 120 字摘要；③ /stub/ws/expire（1008 token_expired）→ conn-2 重订 + 徽章回「已连接」+ 旧缓冲保留（不补历史）+ 新事件续达（3 条）；④ 视觉：浅色主题下徽章 default/行三段式/无溢出，amber 系未触发路径由 stalled 单测覆盖。StrictMode 双挂载幂等由服务端单连接佐证（首引擎 stop 干净）。
- **EventFeed 本地扩展 emptyText**：空态业务句（「对该集合执行写操作后…」）归页面——块加 emptyText 槽而非把业务词写进块（边界正向改进，上游候选）。

### 12.5 torchwood 批 B2：OCC——documents 切片裁决（2026-10-25，取证先行）

取证要点：**OCC 真身 = documents version**（update/delete 必填 CAS，缺省→FailedPrecondition/DOCUMENT.VERSION_REQUIRED、显式 0→InvalidArgument/DOCUMENT.VERSION_INVALID、不匹配→FailedPrecondition/DOCUMENT.VERSION_CONFLICT；冲突时服务端在 gRPC status 的 ErrorInfo metadata 附 current_version 供免读回合并重试）。**runtime-vars 无 OCC 面**（UpdateRuntimeVarRequest 无版本前件——LWW 设计；etag 是 client SDK 读路径轮询 token "{epoch}:{revision}"（D2/D4/D10），console 仅展示）——§12.3 挂账"runtime-vars etag"以此取证关闭。**通道方言**：grpc-gateway 把 FailedPrecondition 映射 **HTTP 400**（非 409——409 是 AlreadyExists（自选 document_id 撞重复键）/Aborted（幂等键进行中））；HTTP 错误体 = `{error:{type, code: gRPC code 字符串, message, error_id, error_code: 枚举}}`——**ErrorInfo/BadRequest details（域码 reason、current_version、field_violations）在 HTTP 面被 errorBodyBuilder 丢弃**（Build 只透传 code/message/errorID，sharedv1.Error 无 details 字段）；message 格式恒为 `"DOMAIN.CODE: 文案[; field: description]"`——**域码判别的唯一可靠面 = message 前缀**。kit 侧：useCommand 结果两分（result/failure 通道）；useCommandForm.onSubmit 把 rejected.fieldErrors 回填 TanStack Form fields（v1 文档化路径）。

1. **切片 = documents 单页族**（detail 编辑/删除 + new 创建 + 列表行删除的命令化）；runtime-vars 不动。列表骨架/批量操作留存量（批 B 裁决 4/8 同款——批量=N 命令聚合直调，不在本批）。
2. **结果两分映射（documents 版）**：`400 + message 前缀 DOCUMENT.VERSION_CONFLICT → conflict`——**OCC 冲突才是 kit conflict 分支的 torchwood 真身（HTTP 409 反而不是：那是重复键/幂等进行中）**，conflict 文案 = 域码中文映射（"文档已被其他修改抢先提交（版本不匹配）……"）；400 其他 → rejected{code=域码前缀（机器判别面）, message=域码中文或网关原文}；409 → conflict（重复键中文）；其余 throw toApiError。域码中文映射表落 fleet/documents.ts（消费方文案权，批 B describeApiError 同层）。
3. **version 前置守卫 = 客户端 rejected 而非 throw**：version 缺失/≤0 → rejected{code: "DOCUMENT.VERSION_REQUIRED", message: 中文}——已知分支不占失败通道（现状 mutationFn throw Error 的换轨形态）。
4. **current_version 对 console 不可达 → conflict UX = 提示 +「刷新重载」**（invalidate 详情存量键 → refetch → 草稿按服务端态重建）。服务端 HTTP 面不透传 status details 是上游缺口（torchwood 仓 errorBodyBuilder），本批不改服务端——挂账上游（console 侧已按 message 前缀工作，details 透传后可升级为"取 current_version 一键合并重试"）。
5. **fieldErrors 形状实证关闭（§12.3 挂账）**：服务端 HTTP 面无字段级机器载荷（violations 只在 message 文本内嵌 `; field: description`，不作解析面）——**服务端 fieldErrors 无数据源，不映射**；**首个真实 fieldErrors 来源 = 客户端提交收敛**（buildDocumentData 的 required 缺失/JSON 无效、increment 非整数——批 B"表单值=展示形，run 内收敛为提交形"同款落 descriptor.run）→ rejected{message, fieldErrors: {attrKey: 文案}}。
6. **表单栈不换**：documents 表单是集合 schema 动态驱动（attributes 元数据 + JsonEditor string 值 + increments 增量区），TanStack Form 换轨是独立批（挂账）；本批 = useCommand + 既有 useState 壳，结果盒为页面局部组件（message-first + fieldErrors 经 DocumentFormFields 的 errors 槽渲染字段级红字）。api-keys 的静态字段表单（批 B）与 documents 的动态 schema 表单自此成为两种形态的对照样例。
7. **treatAs 面**：delete 404 → treatAs not-found → ok 幂等（批 B 先例）；update 404 → throw（失败通道——update 404 语义 = 文档已被删，幂等 ok 不诚实）。
8. **无表单容器命令的 toast 细化**：批 B"结果分支不 toast"裁决的适用面 = 表单结果盒场景；删除（页头按钮/列表行）无结果盒容器——rejected/conflict 不 toast 即丢失，裁决为 toast.error(域码中文)；failure 仍 toast.error(describeApiError)；ok 仍 toast.success。失效桥：存量 `["documents", dbId, collId]` 前缀 onSettled 手动 invalidate（批 B 同款）；不建 Resource（无 kit 查询面——裸 descriptor 工厂闭包路径参数，批 B editApiKeyDescriptor 先例）。
9. **api/databases.ts 写函数加 config 透传**（ApiRequestConfig.__skipToast 通道——命令调用一律豁免全局错误 toast，批 B apiKeys 同款）。

**批 B2 实现期回写（2026-10-25 落地，门禁 121/121 + 浏览器对照通过）**：

- **remove 命令结果透传 bug（映射矩阵单测首跑抓获）**：run 内 `await runDocumentCommand(...)` 把返回值丢弃——OCC 冲突被吞成 ok。修法：`outcome.status === "ok" ? ok : outcome` 透传。void 载荷命令的 ok 映射习惯 = `CommandResult<null>` + `payload: null`（批 B 同款）。
- **treatAs 分工实证**：映射层 404 一律 `throw toApiError(err)`（not-found ApiError）——幂等与否归 descriptor.treatAs（kernel runCommand 只拦截 ApiError；抛原始 axios 错误会绕过 treatAs 直达失败通道）。这正式坐实 treatAs 是"命令作者裁决"层而非"适配器裁决"层。
- **vitest 方言一条：mockResolvedValue 不清调用计数**——页面测试 beforeEach 必须 `mockReset()` 后再设实现（否则 toHaveBeenCalledWith/次数断言跨测试累计漂移，本批三个测试同时"离奇"失败皆此）。
- **浏览器实证**（stub documents 端点 version-CAS + /stub/doc-bump 模拟外部写者）：① 保存 ok → 只读重建 + 时间戳刷新；② 外部 bump 后以陈旧 version 保存 → 冲突盒（域码中文）+「刷新重载」→ fetchQuery fresh-read 草稿按服务端态重建、结果盒清空、保持编辑态；③ 重载基底上合并改名重存 → 成功回只读。**IAB 新坑：空值输入不可达**——`fill("")` 与 Backspace 均不改变受控输入值（非空 fill 正常）——required 空值路径以 jsdom 断言为准（fireEvent.change 真实事件语义覆盖且绿）。
- **stub 方言**：中文 query 参数必须 `--data-urlencode`（裸 UTF-8 query 使 stub 的 `new URL()` 抛错 → node http 400 空响应，初判"端点失灵"实为编码问题）。
- **Form 块第二处本地扩展 resultAction**：结果盒动作槽（冲突「刷新重载」）——与 emptyText 同模式记 vendored 头（上游候选）。页面侧 buildDocumentData/parseFieldValue 随提交收敛迁入 fleet/documents.ts（页面不再持协议知识）。

### 12.6 torchwood 批 D：analytics → MetricChart 配方裁决（2026-10-25，取证先行）

取证要点：torchwood analytics 三处图表全是手拼 recharts + **硬编码 hex 色**（#2563eb 蓝/#16a34a 绿/#e5e7eb 网格——浅色专属，无主题变量）；两处趋势折线（概览页 + 事件详情页）同构：2 序列（total 事件数/uv 活跃用户）、UTC 桶预格式化字符串做 x 轴、h-64；事件详情另有维度拆解 **BarChart（分类柱状，非时序）**；UserActivityPage 无图。依赖缺口：无 shadcn chart 基元（components/ui/chart.tsx）、无 `--chart-1..5` CSS 变量（index.css 无 .dark 段——暗色主题本身缺位）；recharts 3.10.1 已在。fleetly 直迁范式（§12.1 补记）：MetricChart 块（零 kit import）+ 页面投影薄壳 toMetricSeries + serverCapOf。

1. **切片 = 两处趋势折线换 MetricChart**（概览页 + 事件详情页）；**维度拆解 BarChart 留存**——MetricChart 是时序多序列折线，分类柱状不在其面（块不越面），但其硬编码色顺带换 `var(--chart-1)`/主题网格色（暗色可用性一次性修正，结构不动）；**KpiCard → StatCard 挂账**（tone 的 ok/warn 色无 token + KPI 不是图表族——等列表骨架批或第二消费者再裁）；UserActivityPage 不涉及。
2. **依赖缺口补齐**：shadcn chart 基元拷入 `components/ui/chart.tsx`（fleetly 同款 372 行，`cn` import 改 `@/lib/utils`——基元层非 fleet 块）；index.css `:root` 补 `--chart-1..5`（shadcn 默认色板；torchwood 无 .dark 段，暗色主题挂账不在本批）。
3. **投影层 = `routes/analytics/metricChart.tsx` 页面侧薄壳**（fleetly features/metrics/metric-chart.tsx 同位法——analytics 是页面域，不进 fleet/）：`toTrendSeries(points): MetricSeries[]`——固定 2 序列、key 用语义名 total/uv（跨刷新稳定，非 fleetly 的 s{index}——那是动态序列列表的方言，固定序列直接语义名）、`t = Date.parse(bucket)`（UTC 毫秒，数值时间轴）、`v = num()`（int64 string 收敛）；`formatTick` = UTC 桶方言（复用 formatBucket——HOUR `mm-dd hh:00`/DAY `mm-dd`，页面吸收）；`formatValue` = toLocaleString。**timeseriesRows 退役**（预格式化 label 轴是旧方言；其测试锚随删，formatBucket 锚保留）。
4. **全零窗口的业务空态保留页面级**：现页面"全零 → 业务空态文案（没人上报）"是业务口径判断，保留在页面外层 if；块哲学"全零=合法序列照画"不冲突——页面判"有上报"，块判"有样本"，两层各司其职。
5. **块拷贝 = metric-chart.tsx**（vendored @0.1.1）：token 映射同批 A 表（border-line→border-border、text-muted→text-muted-foreground、text-fg→text-foreground）；文案中文化（窗口内无样本 / +N 条序列未显示 / 服务端截断披露句）；serverCap 面保留（本页无截断面不传——analytics timeseries 无该方言）。
6. **测试锚**（vendored 块单测覆盖家在消费方，§12.1 约定）：toTrendSeries 投影锚新增（bucket→t 解析、total/unique_users 的 string→num 收敛、两序列 key/label、空 points→空序列）；shared.test.ts 的 timeseriesRows 锚随退役删除；buildMetricRows 的序列治理锚（排序/上限/零值缺省）由块源拷贝自带语义，消费方不重复锁（fleetly 先例锁的是投影层）。
7. **stub 扩 analytics 端点**（浏览器对照）：/v1/server/analytics/overview + /timeseries（多桶 fixture，HOUR 桶 UTC 对齐）。

**批 D 实现期回写（2026-10-25 落地，门禁 123/123 + 浏览器对照通过）**：

- **react-refresh 约束拆出两份纯函数文件**：torchwood eslint 只许组件文件导出组件——`buildMetricRows` 从块拆至 `components/fleet/values/metric-rows.ts`（vendored 头注明拆分，语义与上游一致）；投影 `toTrendSeries` 并入 `routes/analytics/shared.ts`（与 formatBucket 同居——投影与刻度方言本是一对，react-refresh 约束反促成更诚实的归属）。投影锚落 shared.test.ts（替补 timeseriesRows 退役锚的原位）。
- **chart 色变量方言**：torchwood token 体系是 HSL 三元组（tailwind.config 包 hsl()），但块经 `var(--chart-N)` 直用 presentation attribute——**三元组形态无效，须落完整色值**（`--chart-1: hsl(221 83% 53%)`）。chart-1/2 沿用旧图 hex（#2563eb/#16a34a）保视觉连续（蓝=事件数、绿=活跃用户）；presentation attribute 上的 var() 在现代 Chromium 走得通（SVG2 presentation attribute 按 CSS 声明解析）——线图实渲染佐证。
- **`AnalyticsTimeseriesPoint.unique_users` 改可选**：protojson 零值省略方言——全零 UV 桶运行时缺席该键（服务端 proto3 标量零值不序列化），类型面如实化（投影层 num 收敛 0，stub fixture 专门造了一个缺席桶做对照锚）。
- **浏览器实证**：DAY 视图双线渲染 + UTC 日刻度（10-19…10-25）+ y 轴整数千分位；HOUR 视图小时刻度（10-24 04:00…）+ raw 口径徽标 + uv 缺席桶收敛；事件详情趋势同构；视觉核验（蓝线峰值=字符串桶 "480" 收敛、主题协调、无重叠）。**stub 方言两条**：granularity 参数是枚举全名 `ANALYTICS_GRANULARITY_{HOUR,DAY}`（裸 "HOUR" 比对踩坑——初判"页面没重取"实为 stub 分支错）；**react-query 缓存会让错误响应粘住同 key**——修 stub 后须整页重载而非点选重试。
- **存量缺陷观察（非本批引入，挂账）**：维度拆解 BarChart 的柱体序列在浏览器不渲染（SVG 有轴/网格无 recharts-bar 组）——二分验证与色改动无关（hex 色同样 0 path，换轨前后一致；拆解表格数据正常呈现，UX 可用）。挂账排查 recharts 3.10 + React 19 的 vertical Bar，或后续批统一换 shadcn chart 容器承载。
- **环境坑**：后台 `pnpm dev` 的 wrapper 进程会被会话收割（SIGTERM 143，vite 子进程连带死）——dev server 须以 harness 后台任务形态跑；stub（纯 node）不受影响。

### 12.7 devtool 实现——拷贝制适配的机械化（2026-10-25，裁决先行）

§12.1 痛点清单实施终版。取证要点：registry 源 token 词表 18 形（text-muted ×45、border-line ×17、text-fg/text-err ×9、bg-panel ×9、bg-panel-2 ×7、warn/ok/accent 系 ×18、bg-line ×1…）；双 console 实证映射表已散落在各 vendored 头（fleetly §12.1-4 与 torchwood 批 A–D 头注释）——**devtool 第一步是把散落的实证映射表收拢为仓内单源**。registry-build 三态瑕疵：`@lynx-go/ui-kit@workspace:*`（root devDeps 解析值）与模板 `@^0.1` 混入同列表 + `recharts@catalog:default`（pnpm catalog 协议泄漏——npm publish 0.1.0 事故同类）。

1. **形态 = 仓内 CLI `scripts/devtool.mjs`**（零依赖 node 脚本，与 layer-check/registry-build/size-check 同文化）；**不做独立 npm 包**——消费方是本地双 console，open-code 源码可见即文档，包分发的版本管理成本 > 收益（tarball 痛点 #1 的教训反向适用：工具本身不分发，跟着 checkout 走）。
2. **命令面 v1 = `list` / `profiles` / `copy`**；`diff`（上游块变更 vs 消费方副本的升级同步提示）挂账 v2——拷贝制核心循环是"拷贝 → 手工适配"，自动 diff 需先证明手工适配可稳定叠加。
3. **profile = `scripts/profiles/<name>.json`**：`tokenMap`（类名→类名）+ `cnImport`（规范化目标）+ 可选 note。fleetly/torchwood 两条从两 console 实证 vendored 头提取落仓（差异实证：text-err 与 bg-panel-2 双 console 不同目标；warn/ok/accent 系**不设默认映射**——那是每块语境判断（torchwood amber/emerald、fleetly status vars），工具以警告面呈现而非假装可机械）。
4. **token 引擎 = 词边界类名重写**：`(?<![\w-])token(?![\w-])`——`text-muted` 不得误伤 `text-muted-foreground`（连字符是 token 内部字符，边界须含它）。替换后面源再扫一遍源词表：仍出现的 = 未映射警告（列 token + 出现处）。registry 源不含 `-foreground` 形（demo 方言独占词表），无反向污染。
5. **cn import 规范化 = `@/lib/utils`**：块源恒 `@/lib/utils`，fleetly 走已建 shim（src/lib/utils.ts 转发 cn npm——两世界单源）；torchwood 原生同路径。存量 fleetly 3 文件直 `import { cn } from "cn"` 是 shim 前形态，不回改（copy 默认不覆盖已存在文件）。
6. **vendored 头生成**：既有格式自动化——`// vendored from fleet-ui registry/<family>/<file> @<kitVersion>（<日期> <note>）` + 适配清单（tokenMap 已应用/cn 规范化）+ 手工步骤提示区（未映射 token、检测到的 `tone=`（Badge 方言面）、`@/components/ui/chart`（需随批拷基元））。kitVersion 从 packages/ui-kit/package.json 读。
7. **判断题不自动化**：Badge tone→variant、文案中文化、结构剥离（页壳）、Select 桥——工具把机械面吃掉、把判断题显式列出来（警告即交接单）。痛点 ⑤（tsr generate）⑥（table-core 主入口——上游可直接修，另行处理）⑦（shell-agnostic 化）⑧（严格度穿透——已修）不在本工具面。
8. **registry-build 瑕疵修复（三态）**：`blockDependencies` 排除 `@lynx-go/ui-kit`（core 依赖单源 = 硬编码 semver）；`catalog:` 协议解析——读 pnpm-workspace.yaml catalogs 还原真 semver（recharts ^3.10.1）；解析不到硬错（协议泄漏必须在构建期爆，不能流到 registry.json）。
9. **测试 = `node --test scripts/devtool.test.mjs`**（scripts 层非 workspace 包，无 vitest 面；node 24 内建 runner 零配置）：token 引擎矩阵（边界/误伤/未映射警告）、头生成、依赖提示、profile 完备性（两 profile 对源词表的覆盖面 = 警告面断言）、registry-build 依赖收敛。`pnpm check` 链入 `test:devtool`。

**devtool 实现期回写（2026-10-25 落地，`pnpm check` 全绿 + 真实块干跑对照通过）**：

- **生成头与手工版逐条对应**（干跑 event-feed 对照明证）：工具产出的头 = 机械区（token 映射清单 + cn 规范化）自动化 + 手工区（未映射 warn 系 ×N、Badge tone= 检测）逐条列出——正是批 A–D 各 vendored 头里人写的那两段。工具没有发明新格式，它把既有实践单源化。
- **词边界方言两处坑（测试矩阵锁住）**：① 连字符是 token 内部字符——`(?<![\w-])…(?![\w-])` 否则 `text-muted` 误伤 `text-muted-foreground`（词边界 `\b` 因 `-` 属非词字符而失效）；② 映射目标（如 torchwood 的 `bg-muted`）不得误报未映射——**未映射扫描用源词表枚举正则而非生成式模式**（`(text|bg|…)-(muted|…)` 生成式会把合法目标 `bg-muted` 当方言）。
- **头注释是映射文档不是代码**：端到端断言"输出不含源 token"须切代码体（首个 import 起）——头里 `text-muted→text-muted-foreground` 是合法的文档性出现。
- **copy 默认拒绝覆盖**（--force 例外）：拷贝制的核心循环是"拷贝→手工适配"，重拷会静默抹掉手工层——升级同步走 diff（v2 挂账）而非盲覆盖。
- **registry-build 修复实证**：依赖面收敛为 `@lynx-go/ui-kit@^0.1` + `recharts@^3.10.1` 两项（此前 workspace:\* 与 catalog:default 混入）；catalog 解析不到时构建期硬错（协议泄漏不过夜）。
- 痛点对照收束：②（token 映射表）✓ 工具化；③（基元方言）→ 检测提示（chart 基元/tone=）；④（cn shim）→ profile cnImport 规范化；①（tarball 同步）已被 npm 发版消解；⑤⑥⑦⑧ 维持原处置（上游可修/已修/判断题）。

### 12.8 torchwood 可用性收口——BarChart 根因 + 全站扫查 + 合入 main（2026-10-25）

目标"新 console 尽快可用"的收口批：修已知的用户可见缺陷 → 全站烟雾 → 合 main。

- **BarChart 根因链（D 批挂账的存量缺陷收口）**：维度拆解柱体不渲染 = **recharts 3.10 Bar 入场动画管线在嵌入式 WebView 卡死**——`.recharts-bar-rectangle` 组挂载但 `Rectangle` 因动画未完成永不产出 path（源码定位：Rectangle 的 x/y/w/h 全 NaN/0 防御性返 null；动画态几何未就绪）。多变体二分实证：margin/网格/刻度/radius/Tooltip/容器（ResponsiveContainer 与 shadcn ChartContainer）/数据（真实与静态）逐一排除，**`isAnimationActive={false}` 是唯一决定变量**（关动画后两种数据均正常出柱）。修法与 MetricChart 块自身约定一致（动画/圆点全局关——上游设计"轮询刷新不闪烁"在此意外避坑）。**方法论教训两条**：① HMR 会僵死（编辑不触发更新、lazy chunk 供旧码）——二分实验中途须整页重载/重启 dev server，否则结论被陈旧 bundle 污染（本批一度"修复无效"实为测到旧码）；② vite dev 的 SPA base 下 `/console`（无尾斜杠）落 base 提示页——烟雾扫查的"空白页"先辨工件再定罪。
- **全站烟雾扫查**：stub 补 13 个列表端点（各区 api 模块的响应键空集）+ 未知 GET 兜底回 `{}`；浏览器逐区导航 17 页（Dashboard/api-keys/databases/storage/functions/webhooks/runtime-vars/analytics/users/groups/orders/assets/subscriptions/leaderboards/projects/admins/audit-logs）——全部渲染无空白无错误边界（Dashboard 首扫 0 是 /console 无斜杠工件 + 冷编译 900ms 不够，加长等待/带斜杠后全过）。
- **合入**：torchwood PR #2（feat/console-tanstack-migration → main，30 commits = 批 A–D + B2 + 修复），CI 双绿（Frontend lint+build 1m9s / Backend lint+test+build 8m29s），merge commit `117e4dce`。**新 console 自此在 main 可用**（部署走既有 CI 镜像 + 部署机手动 Redeploy 流程）。存量挂账不阻塞：compat 逐页退场、列表骨架 fleet 化、documents 表单换轨、服务端错误体 details 透传。

### 12.9 torchwood 全量 ui-kit 收尾——总体裁决（2026-10-25，"全部完成"批）

目标：剩余 16 域全部上 kit 绑定，compat 退役，console 全程可用。分支 feat/console-uikit-completion（自 main 117e4dce 拉）。取证定量：legacy 列表栈（ResourceListPage + useServerPaging）16 页，数据面统一 Page<T>{rows, nextPageToken} 方言（与批 A audit-logs 同构）；compat 导入面 31 文件（Link 17/useParams 16/useNavigate 12/useLocation 5/Outlet 4/NavLink 4/useSearchParams 3/Navigate 2/useOutletContext 1 + TestRouter）；手写表单域 runtime-vars/webhooks/projects settings/databases collections/subscriptions/admins。

1. **阶段顺序 = 风险从低到高**：① 列表族 fleet 化（16 域，行为等价 + URL 分页增量）→ ② 写路径命令化 + 表单族 → ③ Dashboard/杂项 → ④ compat 残余清空 → ⑤ kit http 收敛。每阶段门禁全绿再进。
2. **列表族范式（批 A playbook 复用，行为等价基线）**：每域 fleet/<domain>.ts = collectionQuerySchema（defaultSize 沿用现页大小）+ defineResource（collection 适配器：Page<T>→Segment，谓词白名单 = 该域真实服务端过滤参数）+ 路由 validateSearch + 页面 useCollection{from: Route 路径, scope:{projectId}} + ListPage/DataTable/KeysetPagination。**页内当前页搜索保持本地态**（legacy 即此语义，不假装服务端化）；既有服务端过滤（如 api-keys enabled）进 URL 谓词。游标/页大小进 URL = 行为增量（批 A 同款）。
3. **DataTable 行选择 = 受控扩展**（vendored 副本本地扩展，上游候选）：`selection?: { selectedIds: ReadonlySet<string>; onToggle(id); onToggleAll(visibleIds); isRowSelectable? }`——选择态归页面（批量动作是业务编排），块只渲染复选列并上报。api-keys 列表先行样板（行删/批量删/enabled 过滤全接线），随后并行铺开。
4. **写路径与表单**：一切写经 useCommand（结果两分 + __skipToast + 失效桥接——B2 映射层复用/复制）；静态字段表单上 useCommandForm（TanStack Form），动态 schema 表单（documents 已决）保留 useState 壳 + useCommand。fieldErrors 依 B2 范式按域收敛进 descriptor。
5. **compat 退场 = 随页自然退役 + 末班清残**：页面 fleet 化时该页 compat import 自然消亡（useCollection 页不再用 useSearchParams/useNavigate 形态）；阶段 ④ 处理残余共享件（Layout NavLink/PageHeader 等换 TanStack 原生 import + router 类型注册），TestRouter 迁独立测试件，compat.tsx 删除。
6. **http 收敛（阶段 ⑤）**：kit createHttp 的 onUnauthorized 闭环与 torchwood axios 拦截器资产合并评估——若收益不抵风险（拦截器栈是稳定资产），裁决"保留 axios 管线为 torchwood 方言、kit http 收敛关闭"亦是合法终态，以实证定。
7. **验收**：每域门禁（tsc/vitest/eslint/build）+ 抽页浏览器对照；终验收 = 全站扫查 + PR 合 main。测试锚：每域列表换轨保底 2 条（URL 游标往返 + 空态/错误态），写路径按 B2 矩阵。

**§12.9 阶段回写（进行中，2026-10-25）**：

- **阶段 1 落地**（820db9e6，143/143 绿 + 浏览器 9 页抽页）：16 域 + analytics 事件字典全部 useCollection 化。四组并行子代理 + router.tsx 集中接线（16 条 validateSearch）的协作形态成立——关键在 router 接线归主会话单点、代理按变量名报路由定位（行号在并行下必漂）。**DataTable 行选择受控面**（选择态归页面）+ **行点击挡交互元素冒泡**（操作按钮误触行导航——样板期实测抓获，块级语义修正）。**useInfiniteQuery 加载更多 → keyset 分页**（analytics 事件字典）：事件字典量级小，行为等价（百条内单页即全量）。**account 偏好用例 15s 定向去抖**：radix Select 重交互在满载并行下贴 5s 默认线（三组独立取证：单跑恒绿、干净 HEAD 满载复现）——并行度上升是既成事实，定向放宽优于全局加时。
- **阶段 2 落地**（66287264，157/157 绿）：三组并行（E storage/functions/webhooks/leaderboards、F admins/groups/users/account、G runtime-vars/subscriptions/databases 建删）+ 主会话（projects settings 七写路径 + Dashboard collectionQueryOptions 资源化）。**范式收敛点**：runCommandMapped 逐文件复制（不共享——各域错误体微差留给域内，避免共享工具的虚假抽象）；提交形收敛一律进 run（五类型 oneof/ID 派生/grace_days/maxUses/scopes 多行文本——apiKeys mergeScopes 先例的批量复制）；子资源/动作类不挂集合（裸 descriptor + invalidates 声明）。**runtime-vars 取证兑现**：UpdateVarSet 无写前件（LWW）——无 OCC 守卫，§12.5 结论在写路径落地时直接适用。
- **阶段 5 裁决（http 收敛关闭）**：取证 torchwood axios client.ts（132 行）四件资产 = X-Torchwood-Project 头注入（localStorage 单源）/401 单飞刷新+重试+expired=1 重定向/全局错误 toast（__skipToast 豁免）/cookie 会话；kit createHttp 的可收敛面（401 闭环语义 + ApiError 映射）已在全部 fleet 适配器经 toApiError 边界收敛达成，而四件资产全是消费方政策（kit 无对应面）。**裁决：管线本体不统一——axios 是 torchwood 的稳定方言资产，"收敛"的真实含义（类型化 ApiError 边界）已完成**。挂账关闭。

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
- **Q8 registry 对齐**：块依赖 `@lynx-go/ui-kit` 的 semver range 写进 registry item 的 dependencies（shadcn CLI 原生支持 npm range）。
- **Q9 messages 通道**：MessagesProvider（context）+ 块级 props 覆盖（props > context > 内置英文缺省）——形状简单，实现期定稿即可，不再是阻塞项。
- **Q10 mock 能力边界**：mockResource 需支持——延迟/失败注入（测试三态与闭环）、keyset/offset 双方言模拟（demo）、命令结果分支注入（rejected/conflict/ok+reveal）。实现期定稿验收。

## 附录 C：A2/A3 审查与裁决记录（摘要）

六个只读审查视角（概念审计 / React·TanStack DX / 双 Console 可实现性 / 竞品对标 / Agent 可用性 / Effect 集成），合计约 130 条发现（P0×13 / P1×42 / P2×75）。裁决结果：**采纳并修订约 110 条**（含全部 P0），合并/延后约 15 条（多为实现期细节，已并入附录 B 关闭项），拒签约 5 条（例如"EventFeed 改名 FrameFeed"——裁决保留 EventFeed 并修订政策为呈现层豁免记录；"kernel 用 _tag 替 kind"——裁决 kind 站边界、_tag 留缝里）。关键裁决已编入正文并在附录 A #11–#20 记录。交叉验证显著：网络断层通道矛盾（概念×Effect 双命中）、泛型擦除（概念×DX 双命中）、订阅引擎位置（可实现性×Effect 双命中）——独立审查者对同一要害的收敛是发现真实性的强证据。
