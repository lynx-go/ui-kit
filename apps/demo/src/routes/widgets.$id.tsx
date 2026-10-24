import { ConfirmDialog } from "@blocks/command/confirm-dialog";
import { SelectField, TextField } from "@blocks/command/fields";
import { Form } from "@blocks/command/form";
import { DetailPage } from "@blocks/query/detail-page";
import { SectionCard } from "@blocks/shell/section-card";
import { CopyButton } from "@blocks/values/copy-button";
import { type DiffEntry, DiffView } from "@blocks/values/diff-view";
import { JsonField } from "@blocks/values/json-field";
import { RelativeTime } from "@blocks/values/relative-time";
import { StatusBadge } from "@blocks/values/status-badge";
import { useCommand, useCommandForm, usePreference, useRecord } from "@lynx-go/ui-kit";
import { createFileRoute, Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Widget } from "@/lib/mock-data";
import { OWNERS } from "@/lib/mock-data";
import { widgetsClient } from "@/lib/resources";

export const Route = createFileRoute("/widgets/$id")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: WidgetDetailPage,
});

const TAB_KEYS = ["overview", "spec", "settings"] as const;
type TabKey = (typeof TAB_KEYS)[number];

/**
 * 详情页配方（design.md §6.3）：DetailPage[ hero × URL tabs × 内容槽 ](record)。
 * tab 进 search、切 tab = replace（§2.1.1——tab 是页面形态非分页，不吃历史栈）；
 * URL 即真相：深链 ?tab=spec 直达，分享即所得。
 */
function WidgetDetailPage() {
  const { id } = useParams({ from: "/widgets/$id" });
  const { tab } = useSearch({ from: "/widgets/$id" });
  const navigate = useNavigate({ from: "/widgets/$id" });
  const record = useRecord(widgetsClient, { id });

  const activeTab = (TAB_KEYS as ReadonlyArray<string>).includes(tab ?? "")
    ? (tab as TabKey)
    : "overview";

  const onTabChange = (key: string) => {
    // 函数式 search（对象字面量会静默 strip 其他参数）；overview = 缺省值不进 URL
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, tab: key === "overview" ? undefined : key }),
      replace: true,
    });
  };

  return (
    <DetailPage
      record={record}
      eyebrow={
        <Link to="/widgets" className="hover:text-fg">
          ← Widgets
        </Link>
      }
      title={(widget) => widget.name}
      meta={(widget) => (
        <>
          <StatusBadge status={widget.status} />
          <span className="font-mono text-xs text-muted">{widget.id}</span>
          <RelativeTime value={widget.createdAt} />
        </>
      )}
      actions={(widget) => (
        <>
          <CloneButton widget={widget} />
          <DeleteWithRedirect id={widget.id} />
        </>
      )}
      tabs={[
        { key: "overview", label: "Overview", content: <OverviewTab record={record.data} /> },
        { key: "spec", label: "Spec", content: <SpecTab id={id} record={record.data} /> },
        { key: "settings", label: "Settings", content: <SettingsTab widget={record.data} /> },
      ]}
      activeTab={activeTab}
      onTabChange={onTabChange}
    />
  );
}

function OverviewTab({ record }: { record: Widget | undefined }) {
  if (!record) return null;
  const rows: Array<[string, ReactNode]> = [
    ["Status", <StatusBadge key="s" status={record.status} />],
    ["Replicas", String(record.replicas)],
    ["Owner", OWNERS.find((o) => o.id === record.owner)?.name ?? record.owner],
    ["Created", <RelativeTime key="c" value={record.createdAt} />],
  ];
  return (
    <SectionCard
      title="Details"
      description="Record fields — page-owned grid, values blocks inside"
    >
      <dl className="grid grid-cols-[minmax(6rem,1fr)_2fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-xs text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}

/**
 * Spec tab：JsonField 编辑（坏 JSON 不回写）× update 命令 × DiffView 字段级差异。
 * diff 口径 = 最近一次已保存快照 vs 已应用的编辑（fleetly variables diff 的客户端对应）。
 */
function SpecTab({ id, record }: { id: string; record: Widget | undefined }) {
  const savedRef = useRef<Widget | undefined>(record);
  const [applied, setApplied] = useState<unknown | null>(null);
  const [entries, setEntries] = useState<ReadonlyArray<DiffEntry>>([]);

  useEffect(() => {
    if (record) savedRef.current = record;
  }, [record]);

  const update = useCommandForm(widgetsClient.commands!.update, {
    defaultValues: {
      id,
      name: record?.name ?? "",
      status: record?.status ?? "running",
      replicas: record?.replicas ?? 1,
      owner: record?.owner ?? OWNERS[0]!.id,
    },
    onSettled: (result) => {
      if (result?.status !== "ok") return;
      savedRef.current = result.payload;
      setApplied(result.payload);
    },
  });

  // 服务端驱动 defaultValues 重播（§5.4 dirty 不覆盖——demo 从简：key 重挂）
  const spec = record
    ? { name: record.name, status: record.status, replicas: record.replicas, owner: record.owner }
    : null;

  const applySpec = (next: unknown) => {
    if (typeof next !== "object" || next === null) return;
    const draft = next as Record<string, unknown>;
    const prev = savedRef.current;
    const nextEntries: DiffEntry[] = [];
    for (const key of ["name", "status", "replicas", "owner"]) {
      const oldV = prev ? String(prev[key as keyof Widget]) : undefined;
      const newV = draft[key] === undefined ? undefined : String(draft[key]);
      if (oldV !== newV) nextEntries.push({ path: key, old: oldV, new: newV });
    }
    setEntries(nextEntries);
    update.command.mutate({
      id,
      name: String(draft.name ?? ""),
      status: (draft.status as Widget["status"]) ?? "running",
      replicas: Number(draft.replicas ?? 1),
      owner: String(draft.owner ?? OWNERS[0]!.id),
    });
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title="Spec"
        description="JSON view/edit — Apply only writes parsed values (bad JSON never reaches the command)"
      >
        {spec ? (
          <JsonField label="spec.json" value={spec} onChange={applySpec} />
        ) : (
          <p className="text-xs text-muted">Loading…</p>
        )}
        {update.result?.status === "rejected" ? (
          <p className="mt-2 text-xs text-err">{update.result.message}</p>
        ) : null}
      </SectionCard>
      <SectionCard
        title="Changes"
        description="Field-level diff of the last applied edit (server-shaped entries)"
      >
        <DiffView entries={entries} />
        {applied ? (
          <p className="mt-2 text-[11px] text-muted">Saved — record refetched by invalidation.</p>
        ) : null}
      </SectionCard>
    </div>
  );
}

/** 设置页配方（§6.3：设置 = SectionCard × n）——折叠为详情 tab 演示 */
function SettingsTab({ widget }: { widget: Widget | undefined }) {
  const [compact, setCompact] = usePreference("widgets.detail.compact", false);
  const update = useCommandForm(widgetsClient.commands!.update, {
    defaultValues: {
      id: widget?.id ?? "",
      name: widget?.name ?? "",
      status: widget?.status ?? "running",
      replicas: widget?.replicas ?? 1,
      owner: widget?.owner ?? OWNERS[0]!.id,
    },
  });
  if (!widget) return null;
  return (
    <div className="space-y-4">
      <SectionCard
        title="Replicas"
        description="Scaling via the update command (invalidation refetches hero/overview)"
      >
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <Button
              key={n}
              size="sm"
              variant={widget.replicas === n ? "default" : "outline"}
              disabled={update.submitting}
              onClick={() =>
                update.command.mutate({
                  id: widget.id,
                  name: widget.name,
                  status: widget.status,
                  replicas: n,
                  owner: widget.owner,
                })
              }
              data-testid={`replica-${n}`}
            >
              {n}
            </Button>
          ))}
          {update.submitting ? <span className="text-xs text-muted">saving…</span> : null}
        </div>
      </SectionCard>
      <SectionCard title="Display" description="Local preference (usePreference · localStorage)">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={compact}
            onChange={(event) => setCompact(event.target.checked)}
          />
          Compact rows
        </label>
      </SectionCard>
    </div>
  );
}

/** 删除 + 回列表（页面组合：useCommand + ConfirmDialog；块不带导航假设） */
function DeleteWithRedirect({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate({ from: "/widgets/$id" });
  const command = useCommand(widgetsClient.commands!.delete, {
    onSettled: (result) => {
      if (result?.status === "ok") void navigate({ to: "/widgets" });
    },
  });
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Delete"
        disabled={command.pending}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5 text-err" />
      </Button>
      <ConfirmDialog
        open={open}
        title="Delete this widget?"
        description="This action cannot be undone."
        onConfirm={() => {
          setOpen(false);
          command.mutate(id);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

/** clone 配方（§3 派生表）：useRecord 预填 + create 提交——对 refine/ra 的 CloneButton 对应物 */
function CloneButton({ widget }: { widget: Widget }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate({ from: "/widgets/$id" });
  const form = useCommandForm(widgetsClient.commands!.create, {
    defaultValues: {
      name: `${widget.name}-copy`,
      status: widget.status,
      replicas: widget.replicas,
    },
    onSettled: (result) => {
      if (result?.status !== "ok") return;
      setOpen(false);
      void navigate({ to: "/widgets/$id", params: { id: result.payload.id } });
    },
  });

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="clone-widget">
        Clone
      </Button>
      {open ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: demo overlay 外壳——点击 Backdrop 关闭（Base UI Dialog 引入前的占位形态，同 widgets.index 存量；Esc/焦点管理待真实 Dialog 基元）
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Clone widget"
          onClick={() => setOpen(false)}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 内容体拦截 Backdrop 点击 */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: 同上 */}
          <div
            className="w-96 rounded-lg border border-line bg-panel p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-sm font-medium">Clone widget</h2>
            <p className="mb-2 flex items-center gap-1 text-xs text-muted">
              Prefilled from record <span className="font-mono">{widget.id}</span>
              <CopyButton value={widget.id} />
            </p>
            <Form
              form={form.form}
              submitting={form.submitting}
              result={form.result}
              onCancel={() => setOpen(false)}
            >
              <TextField form={form.form} name="name" label="Name" />
              <SelectField
                form={form.form}
                name="status"
                label="Status"
                options={[
                  { value: "running", label: "Running" },
                  { value: "stopped", label: "Stopped" },
                  { value: "degraded", label: "Degraded" },
                ]}
              />
              <SelectField
                form={form.form}
                name="replicas"
                label="Replicas"
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </Form>
          </div>
        </div>
      ) : null}
    </>
  );
}
