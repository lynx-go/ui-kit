export interface Owner {
  id: string;
  name: string;
  email: string;
}

export interface Widget {
  id: string;
  name: string;
  status: "running" | "stopped" | "degraded";
  owner: string;
  replicas: number;
  createdAt: string;
}

const OWNER_NAMES = [
  "Ada Lovelace",
  "Grace Hopper",
  "Alan Turing",
  "Barbara Liskov",
  "Edsger Dijkstra",
  "Radia Perlman",
] as const;

export const OWNERS: Owner[] = OWNER_NAMES.map((name, i) => ({
  id: `owner-${i + 1}`,
  name,
  email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
}));

const STATUSES: Widget["status"][] = ["running", "stopped", "degraded"];

export const WIDGETS: Widget[] = Array.from({ length: 57 }, (_, i) => {
  const created = new Date(Date.now() - i * 47 * 60 * 1000);
  return {
    id: `widget-${String(i + 1).padStart(3, "0")}`,
    name: `widget-${String(i + 1).padStart(3, "0")}`,
    status: STATUSES[i % 3]!,
    owner: OWNERS[i % OWNERS.length]!.id,
    replicas: (i % 5) + 1,
    createdAt: created.toISOString(),
  };
});
