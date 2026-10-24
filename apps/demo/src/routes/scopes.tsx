import { Page } from "@blocks/shell/page";
import { ScopeSwitcher } from "@blocks/shell/scope-switcher";
import { decodePreference, usePreference } from "@fleetly/fleet-ui-kit";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// 双通道作用域同步配方（design §3 派生表 / §7.1——torchwood 实证四件套的
// 参照实现）：URL 是真相，localStorage 承担"上次选中"记忆与跨 tab 桥。
// 四件套：
//   ① 写方向规则——切换 = URL（用户操作 push / 校正归一化 replace）+ 记忆写 storage；
//   ② storage 事件桥——跨 tab 的 storage 事件把新值带回 URL（replace）；
//   ③ synced 守卫——桥回值与当前值相同则不写；
//   ④ 防乒乓——①写 storage 是 setItem 同值幂等，③挡住回环的第二跳。
// 陈旧 id 校正（?project=ghost）：ScopeSwitcher 块内 effect 回落首个可用。

const SCOPE_OPTIONS = [
  { value: "proj-alpha", label: "Alpha (production)" },
  { value: "proj-beta", label: "Beta (staging)" },
  { value: "proj-gamma", label: "Gamma (sandbox)" },
] as const;

const STORAGE_KEY = "scope.project";

export const Route = createFileRoute("/scopes")({
  validateSearch: (search: Record<string, unknown>): { project?: string } => ({
    ...(typeof search.project === "string" && search.project !== ""
      ? { project: search.project }
      : {}),
  }),
  component: ScopesPage,
});

function ScopesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.id });
  const [lastProject, setLastProject] = usePreference<string>(STORAGE_KEY, SCOPE_OPTIONS[0].value);

  // URL + 记忆 = 真相合成：URL 有参数用 URL（深链/分享），否则回落上次选中
  const current = search.project ?? lastProject;

  // ① 写方向规则：用户切换 = push（历史即作用域栈）；校正 = replace（归一化）
  const switchScope = (value: string, meta: { source: "user" | "correction" }) => {
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, project: value }),
      replace: meta.source === "correction",
    });
    setLastProject(value); // 记忆面（setItem 同值幂等——④防乒乓的一半）
  };

  // ② storage 事件桥 + ③ synced 守卫：跨 tab 改作用域带回本 tab（同值不写）
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return;
      const incoming = decodePreference<string | undefined>(event.newValue, undefined);
      if (incoming === undefined || incoming === current) return; // ③ synced 守卫
      void navigate({ to: ".", search: (prev) => ({ ...prev, project: incoming }), replace: true });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [current, navigate]);

  return (
    <Page
      title="Scope sync (URL ↔ storage)"
      description="双通道配方四件套：写方向 / storage 桥 / synced 守卫 / 防乒乓 —— URL 是真相，storage 是记忆与跨 tab 桥。"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <ScopeSwitcher
            label="Project"
            value={current}
            options={SCOPE_OPTIONS}
            onChange={switchScope}
            staleNote="scope no longer exists — fell back to the first available"
          />
          <span
            data-testid="current-scope"
            className="rounded bg-panel-2 px-2 py-0.5 font-mono text-xs text-fg"
          >
            {current}
          </span>
        </div>
        <p className="text-xs text-muted">
          试：切换（URL push + 记忆）→ 无参数重载（回落上次选中）→ 深链
          <code className="mx-1 rounded bg-panel-2 px-1">?project=ghost</code>
          （陈旧 id 校正，replace）→ 另一个 tab 里改 localStorage 同键（storage 桥 带回
          URL，同值不写）。
        </p>
      </div>
    </Page>
  );
}
