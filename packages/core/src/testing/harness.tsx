import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import type { ResourceScope } from "../kernel";
import { ResourceScopeProvider } from "../react/scope";
import type { QuerySearchSchema } from "../schema";

/**
 * /testing —— 消费方测试 harness（页面级渲染 + URL/Query/Scope 三上下文一体接线）。
 *
 * 消费方自建的样板（TestRouter + SearchProbe + per-test QueryClient + scope
 * Provider 包装）在此单源：useCollection 系绑定需要全部三上下文，缺一即假绿。
 * mock 面建议从"数据源"上移到"resource 动词"（defineResource 的 collection/
 * commands 覆写）——本 harness 不绑 mock 方案。
 */

export interface RenderWithKitOptions extends Omit<RenderOptions, "wrapper"> {
  /** 挂载 ui 的路由路径（默认 "/"；支持 $param 段，值由 pathname 给出） */
  path?: string;
  /** 初始 search（经 searchSchema 归一——与真实 validateSearch 同路，非裸对象） */
  search?: Record<string, unknown>;
  /** 与被测页面共用的 schema 实例；给定时接线 validateSearch（不传则 search 原样） */
  searchSchema?: QuerySearchSchema;
  scope?: ResourceScope;
  queryClient?: QueryClient;
}

export interface KitRenderResult {
  /** 解析后的 search 对象（断言用解析值，不读原始 query 串——TanStack 数组方言） */
  getSearch(): Record<string, unknown>;
  queryClient: QueryClient;
}

export async function renderWithKit(
  ui: ReactElement,
  options: RenderWithKitOptions = {},
): Promise<KitRenderResult> {
  const queryClient =
    options.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const path = options.path ?? "/";
  const { searchSchema, search, scope, ...renderOptions } = options;
  const initialSearch = search ?? {};

  const validateSearch = searchSchema
    ? ((input: unknown) =>
        searchSchema.toSearchSchema()["~standard"].validate(input).value) as never
    : undefined;

  const rootRoute = createRootRoute({ validateSearch });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => (
      <ResourceScopeProvider value={scope ?? {}}>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </ResourceScopeProvider>
    ),
  });
  const routeTree = rootRoute.addChildren([pageRoute]);
  // initialEntries 只收字符串——按 TanStack 默认 search 方言（每值 JSON 编码）
  // 自拼 query 串，与真实 URL 解析同路（数组=单键 JSON、数字不落字符串）。
  const qs = Object.entries(initialSearch)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(JSON.stringify(v))}`)
    .join("&");
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [path + (qs ? `?${qs}` : "")],
    }),
  });

  const rendered = render(<RouterProvider router={router} />, renderOptions);
  // RouterProvider 首提交异步——冲刷到稳定再交还断言（torchwood TestRouter 同坑）
  await act(async () => {});

  return {
    getSearch: () => router.state.location.search as Record<string, unknown>,
    queryClient,
  };
}
