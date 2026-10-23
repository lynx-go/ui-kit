import { DeleteButton } from "@blocks/command/delete-button";
import { SelectField, TextField } from "@blocks/command/fields";
import { Form } from "@blocks/command/form";
import { DataTable } from "@blocks/query/data-table";
import { FilterBar } from "@blocks/query/filter-bar";
import { ListPage } from "@blocks/query/list-page";
import { Pagination } from "@blocks/query/pagination";
import { CopyButton } from "@blocks/values/copy-button";
import { RelativeTime } from "@blocks/values/relative-time";
import { StatusBadge } from "@blocks/values/status-badge";
import { useCollection, useCommandForm } from "@fleetly/fleet-ui-kit";
import { createFileRoute } from "@tanstack/react-router";
import { legacyCreateColumnHelper } from "@tanstack/react-table/legacy";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Widget } from "@/lib/mock-data";
import { widgetsClient, widgetsFailureHandle, widgetsSearch } from "@/lib/resources";

export const Route = createFileRoute("/widgets/")({
  validateSearch: widgetsSearch.toSearchSchema(),
  component: WidgetsPage,
});

const col = legacyCreateColumnHelper<Widget>();

const createWidgetCommand = widgetsClient.commands!.create;
const deleteWidgetCommand = widgetsClient.commands!.delete;

/** 消费方对话框外壳（宿主无关 Form 内芯 + demo 本地 overlay；Base UI Dialog 后续经 CLI 引入） */
function NewWidgetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const form = useCommandForm(createWidgetCommand, {
    defaultValues: { name: "", status: "running" as Widget["status"], replicas: 1 },
    onSettled: (result) => {
      if (result?.status === "ok") onClose();
    },
  });

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New widget"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-line bg-panel p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-medium">New widget</h2>
        <Form form={form.form} submitting={form.submitting} result={form.result} onCancel={onClose}>
          <TextField form={form.form} name="name" label="Name" placeholder="widget-058" />
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
        <p className="mt-2 text-[11px] text-muted">
          Tip: name it “reject-me” to see the message-first rejection path.
        </p>
      </div>
    </div>
  );
}

function WidgetsPage() {
  const list = useCollection(widgetsClient, { from: Route.fullPath, search: widgetsSearch });
  const [creating, setCreating] = useState(false);

  const columns = [
    col.accessor("id", {
      header: "ID",
      cell: (info) => (
        <div className="flex items-center gap-1 font-mono text-xs">
          {info.getValue()}
          <CopyButton value={info.getValue()} />
        </div>
      ),
    }),
    col.accessor("name", {
      header: "Name",
      meta: { sortField: "name" },
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    col.accessor("status", {
      header: "Status",
      meta: { sortField: "status" },
      cell: (info) => <StatusBadge status={info.getValue()} />,
    }),
    col.accessor("replicas", {
      header: "Replicas",
      meta: { sortField: "replicas" },
    }),
    col.accessor("createdAt", {
      header: "Created",
      meta: { sortField: "createdAt" },
      cell: (info) => <RelativeTime value={info.getValue()} />,
    }),
    col.display({
      id: "actions",
      header: "",
      cell: ({ row }) => <DeleteButton descriptor={deleteWidgetCommand} input={row.original.id} />,
    }),
  ];

  return (
    <>
      <NewWidgetDialog open={creating} onClose={() => setCreating(false)} />
      <ListPage
        list={list}
        title="Widgets"
        description="Client-evaluated dialect — fetch all, filter/sort/page locally (fleetly mode). URL is the truth."
        actions={
          <>
            <Button variant="default" size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" /> New widget
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                widgetsFailureHandle.failNext({
                  kind: "server",
                  status: 503,
                  message: "injected for demo",
                });
                list.refetch();
              }}
            >
              Simulate failure
            </Button>
          </>
        }
        toolbar={
          <FilterBar list={list} schema={widgetsSearch} textPlaceholder="Search name or id…" />
        }
        pagination={<Pagination list={list} />}
        emptyTitle="No widgets match"
        emptyDescription="Adjust the search or clear filters."
        appendix={
          <p className="text-xs text-muted">
            Appendix slot — consumer-owned content (e.g. CliEquivalent) mounts here.
          </p>
        }
      >
        <DataTable list={list} columns={columns} getRowId={(row) => row.id} />
      </ListPage>
    </>
  );
}
