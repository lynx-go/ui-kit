import { DataTable } from "@blocks/query/data-table";
import { FilterBar } from "@blocks/query/filter-bar";
import { ListPage } from "@blocks/query/list-page";
import { Pagination } from "@blocks/query/pagination";
import { CopyButton } from "@blocks/values/copy-button";
import { RelativeTime } from "@blocks/values/relative-time";
import { StatusBadge } from "@blocks/values/status-badge";
import { useCollection } from "@fleetly/fleet-ui-kit";
import { createFileRoute } from "@tanstack/react-router";
import { legacyCreateColumnHelper } from "@tanstack/react-table/legacy";
import { Button } from "@/components/ui/button";
import type { Widget } from "@/lib/mock-data";
import { widgetsClient, widgetsFailureHandle, widgetsSearch } from "@/lib/resources";

export const Route = createFileRoute("/widgets/")({
  validateSearch: widgetsSearch.toSearchSchema(),
  component: WidgetsPage,
});

const col = legacyCreateColumnHelper<Widget>();

function WidgetsPage() {
  const list = useCollection(widgetsClient, { from: Route.fullPath, search: widgetsSearch });

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
  ];

  return (
    <ListPage
      list={list}
      title="Widgets"
      description="Client-evaluated dialect — fetch all, filter/sort/page locally (fleetly mode). URL is the truth."
      actions={
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
  );
}
