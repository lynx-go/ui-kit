# @lynx-go/uikit

Headless core + copy-owned UI blocks for data-dense console UIs — **Query / Command / Subscription** over TanStack engines.

[简体中文](README_ZH.md)

## The idea

A console page is three interaction primitives plus one interaction surface, and none of them need a new engine:

| Noun | Role | What you get |
| --- | --- | --- |
| **Query** | look | Filtered / paginated collections whose window state lives in the URL |
| **Command** | do | Named verbs returning `CommandResult` branches, with declarative cache invalidation |
| **Subscription** | listen | Cursor-located **Frame** delivery — backlog → follow, resync after gaps, backoff → polling |
| **Resource** | surface | The noun the other three attach to; one `defineResource` wires queries, commands and scopes |

Design principles, held mechanically (not aspirationally):

- **TanStack native.** Router (typed routes + `validateSearch`), Query, Table, Form are the engines. uikit binds them; it does not re-wrap them.
- **The URL is the truth.** Every query window is URL state. Setters are functional: pagination pushes (history is the paging stack), predicates/sort replace and reset the cursor.
- **Failure ≠ result.** `ApiError` is a closed set and throws at the transport seam; `CommandResult` comes back as value branches (`ok` / `rejected` / `conflict`) — expected outcomes never travel as exceptions.
- **Frames, not events.** Subscriptions deliver positioned frames with cursors — resumable, reorderable into buffers, and degradable to polling — not opaque pub/sub callbacks.
- **Effect lives in the seams.** The kernel is zero-dependency, zero-React algebra. Effect-TS is confined to the schema/adapters layer; `react/` and the block registry cannot even import it (enforced by `pnpm layer-check`).

## Package & distribution

Two channels, deliberately different:

- **`@lynx-go/uikit-core`** (`packages/core`) — the headless core: kernel contracts + URL codec + HTTP pipeline/subscription engine + React bindings + testing harness. Published to npm, source-distributed.
- **`registry/`** — five families of UI blocks, shadcn-style: you *copy* them, you own the code. Blocks contain no business entities and fetch nothing; they only consume binding output.

```bash
npm install @lynx-go/uikit-core
# peers: react >=19 · @tanstack/react-query >=5.100 · @tanstack/react-router >=1.120 (optional) · @tanstack/react-form >=1.30 (optional)
```

## Quick start

Declare a Resource, share one search schema between route and bindings, read the collection:

```tsx
// lib/projects.ts
import { mockCollection } from "@lynx-go/uikit-core/adapters";
import { defineResource } from "@lynx-go/uikit-core/kernel";
import { collectionQuerySchema } from "@lynx-go/uikit-core/schema";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

const mock = mockCollection<Project>(
  [
    { id: "p1", name: "edge-1", createdAt: "2026-01-04T09:00:00Z" },
    { id: "p2", name: "edge-2", createdAt: "2026-01-11T09:00:00Z" },
  ],
  { dialect: "offset", latencyMs: 80 },
);

export const projectsResource = defineResource({
  name: "projects",
  getId: (row) => row.id,
  collection: mock.collection,
  commands: {
    rename: {
      run: async (input: { id: string; name: string }) => {
        const rows = mock.handle.rows();
        const row = rows.find((p) => p.id === input.id);
        if (!row) return { status: "rejected", message: "project not found" };
        mock.handle.replaceRows(
          rows.map((p) => (p.id === input.id ? { ...p, name: input.name } : p)),
        );
        return { status: "ok", payload: { ...row, name: input.name } };
      },
    },
  },
});

// Query window state lives in the URL — route and bindings share one schema instance.
export const projectsSearch = collectionQuerySchema({ defaultSize: 20 });
```

```tsx
// routes/projects.index.tsx — TanStack Router file route
import { useCollection } from "@lynx-go/uikit-core";
import { createFileRoute } from "@tanstack/react-router";
import { projectsResource, projectsSearch } from "@/lib/projects";

export const Route = createFileRoute("/projects/")({
  validateSearch: projectsSearch.toSearchSchema(),
  component: ProjectsPage,
});

function ProjectsPage() {
  // Window (page / filters / sort) comes from the URL; setters are functional.
  const list = useCollection(projectsResource, { from: Route.id, search: projectsSearch });

  if (list.status === "loading") return <p>Loading…</p>;

  return (
    <ul>
      {list.rows.map((project) => (
        <li key={project.id}>{project.name}</li>
      ))}
    </ul>
  );
}
```

Commands are the same story with value-branch results and default invalidation (every query of the same resource refetches on settle):

```tsx
const form = useCommandForm(projectsResource.commands.rename, {
  defaultValues: { name: "" },
  onSettled: (result) => {
    if (result?.status === "ok") closeDialog();
    // "rejected" carries message + fieldErrors — render them, don't catch them
  },
});
```

Subscriptions deliver positioned frames you can resume, buffer, or let degrade to polling:

```tsx
const sub = useSubscription(eventsStream, {
  cursor,                        // resume exactly where you left off
  getCursor: (frame) => frame.seq,
  onFrame: appendLiveEvent,
});
```

Swap `mockCollection` for `clientCollection` (HTTP pipeline, offset/keyset dialects, NDJSON/SSE transports) when a real backend exists — the binding layer does not change.

## UI blocks: copy, don't depend

Blocks are not npm dependencies; they are copied into your repo with token-dialect adaptation, and you own them from then on:

```bash
node scripts/devtool.mjs copy query/list-page --to ../your-console --profile your-profile
node scripts/devtool.mjs diff --all --dir src/components/kit --check   # drift gate after upgrades
```

| Family | Presents | Examples |
| --- | --- | --- |
| `values` | a value | `status-badge`, `relative-time`, `stat-card`, `metric-chart`, `states` |
| `query` | a collection | `list-page`, `data-table`, `filter-bar`, `pagination`, `keyset-pagination`, `detail-page` |
| `command` | a verb | `form`, `fields`, `delete-button`, `confirm-dialog` |
| `subscription` | a stream | `event-feed`, `log-viewer`, `stage-timeline` |
| `shell` | the page | `app-shell`, `page`, `stepper`, `scope-switcher`, `route-error-boundary` |

`registry/registry.json` is shadcn-CLI compatible; the devtool adds consumer token-dialect profiles and vendored headers so later upgrades stay diffable.

## Repo layout

```
packages/core   @lynx-go/uikit-core  kernel / schema / adapters / react / testing
registry/       UI blocks, five families (copy-based distribution)
apps/demo       living documentation — every recipe is a runnable page
docs/           design.md (decisions & history) · SKILL.md (page-author guide) · llms.txt
scripts/        layer-check · registry-build · devtool (copy/diff) · size-check
```

Layering is enforced, not encouraged: kernel has zero runtime deps and zero React imports; dependencies flow one way; `react/` and `registry/` cannot import Effect.

## Documentation

- [docs/design.md](docs/design.md) — the full design document: every decision with its evidence and a dated change log (in Chinese).
- [docs/SKILL.md](docs/SKILL.md) — the page-author's guide, written for AI agents and humans writing console pages.
- [apps/demo](apps/demo) — runnable recipes: list/detail pages, wizards, scoped resources, streams, failure states.
- [docs/llms.txt](docs/llms.txt) — machine-facing index.

## Status

Pre-1.0 (`0.3.x`), driving internal production consoles. Expect breaking changes between minors; they are recorded as dated batches in [docs/design.md](docs/design.md).

## License

MIT
