import { DataTable } from "@blocks/query/data-table";
import { KeysetPagination } from "@blocks/query/keyset-pagination";
import { ListPage } from "@blocks/query/list-page";
import { Page } from "@blocks/shell/page";
import { ResourceScopeProvider, useCollection } from "@lynx-go/uikit-core";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { scopedWidgets, scopedWidgetsSearch } from "@/lib/resources";
import { cn } from "@/lib/utils";

// scope 单源配方（§12.10-③）：ResourceScopeProvider 挂应用/区块根部，页面绑定
// 不再逐处传 scope 字面量/写 enabled 守卫——
//   ① 绑定省略 scope 时从 Provider 取值（显式传入优先，逃生舱）；
//   ② 资源声明了 scope 键而 Provider 值缺键 ⇒ 查询自动停用（fail-safe，
//     "未就绪"不产出"无 scope 键"下的空段缓存）；
//   ③ scope 变化经 canonicalScope 进 queryKey——切项目 = 换键重取，互不污染。
// 本页用"未选择项目"三态演示 ②：切到空值时列表停在 loading（查询停用），
// 而非发出无 scope 的请求。

const PROJECT_OPTIONS = [
  { value: "", label: "— no project (scope not ready) —" },
  { value: "proj-alpha", label: "proj-alpha" },
  { value: "proj-beta", label: "proj-beta" },
] as const;

export const Route = createFileRoute("/scope-provider")({
  validateSearch: scopedWidgetsSearch.toSearchSchema(),
  component: ScopeProviderPage,
});

function ScopeProviderPage() {
  const [project, setProject] = useState<string>("proj-alpha");
  return (
    <Page title="Scope provider (context single-source)">
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <label htmlFor="project-switcher">project scope:</label>
        <select
          id="project-switcher"
          className="h-8 rounded-md border border-line bg-panel px-2 text-fg"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          aria-label="Project scope"
        >
          {PROJECT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span
          data-testid="scope-state"
          className={cn(
            "rounded-full px-2 py-0.5",
            project === "" ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok",
          )}
        >
          {project === "" ? "not ready — queries suspended" : `ready · ${project}`}
        </span>
      </div>
      <ResourceScopeProvider value={{ projectId: project || undefined }}>
        <ScopedList />
      </ResourceScopeProvider>
    </Page>
  );
}

function ScopedList() {
  // 无 scope 字面量、无 enabled 守卫——两者都由 Provider 契约承担
  const list = useCollection(scopedWidgets, {
    from: Route.id,
    search: scopedWidgetsSearch,
  });
  return (
    <ListPage
      list={list}
      emptyTitle="No widgets in this project"
      pagination={<KeysetPagination list={list} />}
    >
      <DataTable
        list={list}
        getRowId={(row) => row.id}
        columns={[
          { accessorKey: "id", header: "ID" },
          { accessorKey: "name", header: "Name" },
          { accessorKey: "project", header: "Project" },
        ]}
      />
    </ListPage>
  );
}
