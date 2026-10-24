# fleet-ui SKILL.md（页面作者册）

> 面向用 fleet-ui 写 console 页面的 AI agent 与开发者。适配器作者册见文末指针。
> 完整设计：docs/design.md。反模式与幻觉诱饵在最后——先读它们能省一半调试。

## 心智模型（就 4 个名词）

- **Query（问）**：缓存读。列表用 `useCollection`，详情 `useRecord`，外键 `useBatch`。
- **Command（令）**：具名动词写面。`useCommand(descriptor, { scope, onSettled })`（rejected/conflict 是结果、失败才走 error 通道、ok 后默认失效同资源查询）；表单用 `useCommandForm(descriptor, { defaultValues, onSettled })` + `<Form>` 块 + `TextField/SelectField`；行删除用 `<DeleteButton descriptor input />`（内置确认框）。
- **Subscription（听）**：帧流。`useSubscription(descriptor | transport, { cursor, getCursor, onFrame, policy? })` 返回引擎句柄（status/error/resyncs + pause/resume/restart/resync/clear）。见下方"订阅页"一节。
- **Resource**：后端某实体/流的交互面，由适配器作者用 `defineResource` 定义——你在页面上只管 import 它。

页面 = 路由（search schema）→ 绑定 hook → 块组件。三步，每个页面同构。

## 列表页（90% 的页面）

```tsx
// 1) 模块级建 search schema（与路由共用同一实例）
const widgetsSearch = collectionQuerySchema({
  text: ["name"], filters: [{ field: "status", op: "eq", options: [...] }], defaultSize: 8,
});

// 2) 路由：Standard Schema 直传 validateSearch
export const Route = createFileRoute("/widgets/")({
  validateSearch: widgetsSearch.toSearchSchema(),
  component: WidgetsPage,
});

// 3) 页面：绑定 + 块
function WidgetsPage() {
  const list = useCollection(widgetsClient, { from: Route.fullPath, search: widgetsSearch });
  return (
    <ListPage list={list} title="Widgets"
      toolbar={<FilterBar list={list} schema={widgetsSearch} />}
      pagination={<Pagination list={list} />}>          {/* keyset 方言用 KeysetPagination */}
      <DataTable list={list} columns={columns} getRowId={(r) => r.id} />
    </ListPage>
  );
}
```

- URL 键名：`q` / `filter=field:op:value` / `sort=field:dir` / `cursor` / `page` / `size`。
- "URL + schema 默认值"即真相；翻页=push（历史栈即分页栈），过滤/排序=replace+回第一页。
- 四态（loading/empty/error/success）由 ListPage 切换；你只写 success 态的 children。
- 预取：`collectionQueryOptions(resource, query)` 进 route loader 的 `ensureQueryData` + `Link preload="intent"`。

## 详情 / 自定义内容页

- 详情：`useRecord(resource, { id })` + `Page` 外壳（宽三档 wide|narrow|flow）。
- **自定义内容页没有特殊机制**：普通文件路由 + `Page` + 任意组合（无 CustomPage——框架不拥有页面类型）。

## 外键

- 列内显名：`useBatch(resource, ids).byId.get(id)`。
- 搜索选择：`<ReferenceSelect resource={otherResource} …/>`（局部状态，不进 URL）。

## 权限

- 页级门控：`beforeLoad` 里 loader 预取 identity + redirect（渲染前完成）。
- 元素级显隐：`useCan`（fail-closed；"未就绪"与"拒绝"是两个渲染态）。

## 订阅页（events / logs 两形）

```tsx
// 裸 Transport（日志流——logs 这类特殊流可以不造 Resource）
const sub = useSubscription(logsTransport, { cursor: null }); // null = 活尾，立即开
<LogViewer sub={sub} formatLine={(f) => `${f.ts} ${f.msg}`} />

// backlog 定锚 × 续订（events 组合页）
const list = useCollection(eventsResource, { from: Route.fullPath, search: eventsSearch });
const [anchor, setAnchor] = useState<Cursor | null>(null);
// …backlog 首次成功 → setAnchor(最新一端)…
const sub = useSubscription(eventsStream, { cursor: anchor ?? undefined, getCursor: (f) => String(f.seq) });
<EventFeed sub={sub} backlog={list.rows.slice().reverse()} /* 时间正序传入 */ getKey={(f) => f.seq} />
```

- **cursor 语义**：`undefined` = 待命不开（等 backlog 定锚）；`null` = 活尾立即开；值 = 从锚点续订。
- **状态机**：live（连接建立）/ reconnecting（含首连与退避）/ paused / gapped / stalled（退避耗尽，轮询兜底是你的组合）/ ended（服务端收流）/ error（带 ApiError）。
- **gapped 配方**：黄条出现 → 重跑 backlog（`queryClient.fetchQuery` fresh-read）→ `sub.resync(newAnchor)`（resyncs++ 供黄条）。
- 块内部经 `sub.subscribeFrames/getFrames` 订帧存储——页面级帧到达不重渲染。
- descriptor 形态（`Resource.subscriptions` 条目）**必须声明 `policy`**（buffer/retry 声明在流侧，兼作运行时判别）。

## 反模式（必读）

1. 禁给块传 url/resource 让它自己拉数——块只消费 `list` 句柄。
2. 禁 useState 存分页/过滤/排序——URL 即真相（竞品训练反射是反的）。
3. 禁渲染期 navigate——setter 走事件（库内已保证）。
4. 禁 try/catch 处理命令拒绝——rejected 是返回值；只有失败（网络/401/解码）走 error 通道。
5. 禁用 Zod 写 search schema（Effect Schema 单源）；禁 Radix 路径（Base UI 方言）。
6. 禁页面层 catch 401 跳登录——全局闭环已接三通道。
7. 禁乐观更新/undo——C 类拒签项，默认同步等待。
8. 禁造 CustomPage / 页面登记——自定义页面就是普通路由。
9. 禁把 Resource 当 react-admin 的 `<Resource>`（路由注册）——纯数据契约，路由自己写。
10. 禁用换 cursor prop 的方式重锚——gapped 后用 `sub.resync(newAnchor)`（原地重锚 + resyncs 计数）；cursor prop 变化 = 整个订阅重建。
11. 禁在页面层逐帧消费 `sub.frames` 做渲染——页级只读状态；帧渲染交给 LogViewer/EventFeed（它们订帧存储）。
12. 禁给 transport 的迭代器写"完成即收流"——完成是终态判据（closeReason），想要重连语义应当**抛错**（§5.3 分诊矩阵）。

## 幻觉诱饵（训练数据 → 正确姿势）

| 你可能想写的                                           | 正确的                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| refine `useSubscription(channel, params, onEvent)`     | fleet `useSubscription(descriptor\|transport, {cursor, getCursor, onFrame})` 返回引擎句柄（完全同名不同义！） |
| EventSource 自动重连                                   | 引擎拥有重连（backoffMs 序列）；SSE transport 断开即抛错交引擎退避         |
| 心跳/中断分不清就当 ended                              | 完成是终态判据（isEnded/endEvent 帧内容裁决）；分不清就抛错让引擎重连     |
| react-admin `<Resource name list create>`              | Resource = 纯数据契约；路由自己写                                         |
| dataProvider `{pagination:{page,perPage},sort,filter}` | `CollectionQuery {predicate, order, window}`                              |
| refine useTable 的 tableProps / pagination.current     | `useCollection` 的 list 句柄 / `window.size`                              |
| Zod validateSearch                                     | `collectionQuerySchema(...).toSearchSchema()`                             |
| useNotify / notificationProvider                       | 无内置 toast；`onSettled` + sonner                                        |
| Relay pageInfo/endCursor                               | `Segment {rows, total?, nextCursor?}`                                     |

## 适配器作者

见 docs/design.md §2（契约签名）、§5（Effect 缝隙）、§5.2（protojson 配方：int64 双策略/枚举全名/repeated 序列化/零值缺席）、§5.1（401 闭环管线次序）、§5.3 实现期裁决（订阅引擎分诊矩阵）。核心入口：`createHttp({ onUnauthorized })`、`defineResource`、`clientCollection(fetchAll)`、`mockCollection`、`ndjsonTransport`/`sseTransport`（终态判据 isEnded/endEvent 归你的适配器）、`mockTransport`（测试/demo 帧流）、`createSubscriptionEngine`（命令式消费，quickstart 直开 Transport `for await` 亦可）。
