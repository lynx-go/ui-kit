import type { NavSection } from "@blocks/shell/app-shell";

export const nav: NavSection[] = [
  {
    label: "Overview",
    items: [{ label: "Overview", to: "/" }],
  },
  {
    label: "Recipes",
    items: [
      { label: "Widgets (client-evaluated)", to: "/widgets" },
      { label: "Widgets (keyset)", to: "/widgets/keyset" },
      { label: "By owner (reference)", to: "/owners" },
      { label: "Events (backlog × follow)", to: "/events" },
      { label: "Logs (ndjson stream)", to: "/logs" },
      { label: "Quickstart (wizard)", to: "/quickstart" },
    ],
  },
];
