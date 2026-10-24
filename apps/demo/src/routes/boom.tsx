import { Page } from "@blocks/shell/page";
import { RouteErrorBoundary } from "@blocks/shell/route-error-boundary";
import { createFileRoute, type ErrorComponentProps, useNavigate } from "@tanstack/react-router";

// 每路由错误边界配方（design §6.1 RouteErrorBoundary 参照实现）：component
// 抛错 → errorComponent 兜底；Retry 的恢复语义归页面——这里先清失败参数
// （fail=1 → false，replace 归一化）再 reset 重渲染。数据面错误走 ListPage
// 四态（那是查询失败可重取），页面崩溃走这里。
export const Route = createFileRoute("/boom")({
  validateSearch: (search: Record<string, unknown>): { fail: boolean } => ({
    fail: search.fail === 1 || search.fail === "1" || search.fail === true,
  }),
  errorComponent: BoomError,
  component: BoomPage,
});

function BoomError({ error, reset }: ErrorComponentProps) {
  const navigate = useNavigate();
  return (
    <RouteErrorBoundary
      error={error}
      reset={() => {
        // 恢复流程：先清失败参数（replace 归一化），落定后 reset 重渲染
        void navigate({ to: "/boom", search: { fail: false }, replace: true }).then(reset);
      }}
    />
  );
}

function BoomPage() {
  const { fail } = Route.useSearch();
  if (fail) {
    throw new Error("Injected failure (search ?fail=1) — retry clears the flag and re-renders");
  }
  return (
    <Page
      title="Boom (recoverable)"
      description="错误边界演示页：?fail=1 让 component 抛错——RouteErrorBoundary 兜底，Retry 清参恢复。"
    >
      <p data-testid="boom-ok" className="text-sm text-fg">
        Healthy. Append <code className="rounded bg-panel-2 px-1">?fail=1</code> to the URL to blow
        this page up, then hit Retry.
      </p>
    </Page>
  );
}
