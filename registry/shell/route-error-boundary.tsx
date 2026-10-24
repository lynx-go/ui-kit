import { isApiError } from "@fleetly/fleet-ui-kit/kernel";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * RouteErrorBoundary（shell 块）——每路由错误边界（四态之外的页级错误态，
 * design §6.1）：路由 loader/component 抛出的错误兜底呈现 + Retry 一等按钮。
 * 与 ListPage 四态的 error 分支分工：那是数据面的错误（查询失败可重取），
 * 这是页面面的错误（渲染/loader 崩了）。reset 接 TanStack Router
 * errorComponent 的 reset（重跑 loader/重渲染）；页面可包一层注入自己的
 * 恢复语义（如先清失败参数再 reset——demo boom 页是参照实现）。
 */
export interface RouteErrorBoundaryProps {
  error: unknown;
  /** 重试动作（router 的 reset，或页面自定恢复流程） */
  reset: () => void;
  title?: string;
}

function describe(error: unknown): string {
  if (isApiError(error)) {
    switch (error.kind) {
      case "network":
        return "Network unreachable. Check your connection and retry.";
      case "auth":
        return "Session expired — sign in again.";
      case "forbidden":
        return "You do not have access to this page.";
      case "not-found":
        return "This page no longer exists.";
      case "decode":
        return `Unexpected response format (${error.detail}).`;
      case "server":
        return `Server error ${error.status}${error.message ? `: ${error.message}` : ""}.`;
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function RouteErrorBoundary({
  error,
  reset,
  title = "This page failed to load",
}: RouteErrorBoundaryProps) {
  return (
    <div
      role="alert"
      className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-3 p-12 text-center"
    >
      <TriangleAlert className="size-6 text-warn" />
      <div className="text-sm font-medium">{title}</div>
      <div className="max-w-md font-mono text-xs text-muted">{describe(error)}</div>
      <Button variant="outline" size="sm" onClick={reset}>
        <RotateCw className="size-3.5" /> Retry
      </Button>
    </div>
  );
}
