import { DataTable } from "@blocks/query/data-table";
import { FilterBar } from "@blocks/query/filter-bar";
import { ListPage } from "@blocks/query/list-page";
import { Pagination } from "@blocks/query/pagination";
import { ReferenceSelect } from "@blocks/query/reference-select";
import { Page } from "@blocks/shell/page";
import { useBatch, useCollection } from "@fleetly/ui-kit";
import { createFileRoute } from "@tanstack/react-router";
import { legacyCreateColumnHelper } from "@tanstack/react-table/legacy";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { Widget } from "@/lib/mock-data";
import { ownersResource, ownersSearch, widgetsClient } from "@/lib/resources";

export const Route = createFileRoute("/owners")({
  validateSearch: ownersSearch.toSearchSchema(),
  component: OwnersPage,
});

const col = legacyCreateColumnHelper<Widget>();

function OwnersPage() {
  const list = useCollection(widgetsClient, { from: Route.id, search: ownersSearch });

  // 批解析绑定：外键 → 名称（react-admin ReferenceField 的对应物）
  const ownerIds = [...new Set(list.rows.map((w) => w.owner))];
  const owners = useBatch(ownersResource, ownerIds);

  const columns = [
    col.accessor("name", {
      header: "Name",
      meta: { sortField: "name" },
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    col.accessor("owner", {
      header: "Owner",
      cell: (info) => owners.byId.get(info.getValue())?.name ?? info.getValue(),
    }),
    col.accessor("replicas", { header: "Replicas", meta: { sortField: "replicas" } }),
  ];

  return (
    <Page title="Widgets by owner" description="ReferenceSelect + batch resolution demo">
      <Card className="mb-4">
        <CardHeader>Pick an owner (local select state — not URL-worthy intent)</CardHeader>
        <CardContent className="max-w-sm">
          <ReferenceSelect
            resource={ownersResource}
            getLabel={(owner) => owner.name}
            getValue={(owner) => owner.id}
            searchFields={["name"]}
            value={null}
            onChange={(ownerId) =>
              ownerId === null
                ? list.setPredicate(null)
                : list.setPredicate({ field: "owner", op: "eq", value: ownerId })
            }
            placeholder="Search owners…"
          />
        </CardContent>
      </Card>
      <ListPage
        list={list}
        title="All widgets"
        toolbar={<FilterBar list={list} schema={ownersSearch} textPlaceholder="Search name…" />}
        pagination={<Pagination list={list} />}
        emptyTitle="No widgets match"
      >
        <DataTable list={list} columns={columns} getRowId={(row) => row.id} />
      </ListPage>
    </Page>
  );
}
