import { clientCollection, mockCollection, mockFetchAll } from "@fleetly/fleet-ui-core/adapters";
import { defineResource } from "@fleetly/fleet-ui-core/kernel";
import { collectionQuerySchema } from "@fleetly/fleet-ui-core/schema";
import type { Owner, Widget } from "./mock-data";
import { OWNERS, WIDGETS } from "./mock-data";

// ============ 资源（适配器作者视角：mock 驱动，双方言对照） ============

const ownersMock = mockCollection(OWNERS, { dialect: "offset", latencyMs: 80 });

export const ownersResource = defineResource({
  name: "owners",
  getId: (row: Owner) => row.id,
  collection: ownersMock.collection,
  record: ownersMock.record,
  batch: ownersMock.batch,
});

/** fleetly 方言：整取 + 客户端求值（clientCollection 伪造游标） */
const widgetsFetchAll = mockFetchAll(WIDGETS, { latencyMs: 100 });
export const widgetsClient = defineResource({
  name: "widgets",
  getId: (row: Widget) => row.id,
  collection: clientCollection(widgetsFetchAll),
  record: (id: string) => {
    const widget = WIDGETS.find((w) => w.id === id);
    if (!widget)
      throw { kind: "not-found" } satisfies import("@fleetly/fleet-ui-core/kernel").ApiError;
    return Promise.resolve(widget);
  },
  batch: (ids) => Promise.resolve(WIDGETS.filter((w) => ids.includes(w.id))),
});
/** 四态演示：失败注入句柄（demo 专属，消费方代码） */
export const widgetsFailureHandle = widgetsFetchAll;

/** torchwood 方言：keyset 无 total（空尾页停发令牌） */
const widgetsKeysetMock = mockCollection(WIDGETS, { dialect: "keyset", latencyMs: 120 });
export const widgetsKeyset = defineResource({
  name: "widgets-keyset",
  getId: (row: Widget) => row.id,
  collection: widgetsKeysetMock.collection,
});

// ============ search schema（路由与绑定共用同一实例） ============

export const widgetsSearch = collectionQuerySchema({
  text: ["name", "id"],
  filters: [
    {
      field: "status",
      op: "eq",
      label: "Status",
      options: [
        { value: "running", label: "Running" },
        { value: "stopped", label: "Stopped" },
        { value: "degraded", label: "Degraded" },
      ],
    },
  ],
  defaultSize: 8,
  defaultOrder: [{ field: "createdAt", dir: "desc" }],
});

export const widgetsKeysetSearch = collectionQuerySchema({
  text: ["name"],
  defaultSize: 8,
  defaultOrder: [{ field: "name", dir: "asc" }],
});

export const ownersSearch = collectionQuerySchema({
  text: ["name"],
  filters: [
    {
      field: "owner",
      op: "eq",
      label: "Owner",
      options: OWNERS.map((owner) => ({ value: owner.id, label: owner.name })),
    },
  ],
  defaultSize: 8,
});
