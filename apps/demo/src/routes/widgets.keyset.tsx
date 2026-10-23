import { DataTable } from "@blocks/query/data-table";
import { FilterBar } from "@blocks/query/filter-bar";
import { KeysetPagination } from "@blocks/query/keyset-pagination";
import { ListPage } from "@blocks/query/list-page";
import { RelativeTime } from "@blocks/values/relative-time";
import { StatusBadge } from "@blocks/values/status-badge";
import { useCollection } from "@fleetly/fleet-ui-kit";
import { createFileRoute } from "@tanstack/react-router";
import { legacyCreateColumnHelper } from "@tanstack/react-table/legacy";
import type { Widget } from "@/lib/mock-data";
import { widgetsKeyset, widgetsKeysetSearch } from "@/lib/resources";

export const Route = createFileRoute("/widgets/keyset")({
  validateSearch: widgetsKeysetSearch.toSearchSchema(),
  component: WidgetsKeysetPage,
});

const col = legacyCreateColumnHelper<Widget>();

function WidgetsKeysetPage() {
  const list = useCollection(widgetsKeyset, { from: Route.fullPath, search: widgetsKeysetSearch });

  const columns = [
    col.accessor("name", {
      header: "Name",
      meta: { sortField: "name" },
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    col.accessor("status", {
      header: "Status",
      cell: (info) => <StatusBadge status={info.getValue()} />,
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
      title="Widgets — keyset"
      description="Keyset dialect — opaque cursor in the URL, no total; browser history is the pagination stack (torchwood mode)."
      toolbar={
        <FilterBar list={list} schema={widgetsKeysetSearch} textPlaceholder="Search name…" />
      }
      pagination={<KeysetPagination list={list} />}
      emptyTitle="No widgets match"
    >
      <DataTable list={list} columns={columns} getRowId={(row) => row.id} />
    </ListPage>
  );
}
