import { AppShell } from "@blocks/shell/app-shell";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { nav } from "@/lib/nav";

export const Route = createRootRoute({
  component: () => (
    <AppShell nav={nav}>
      <Outlet />
    </AppShell>
  ),
});
