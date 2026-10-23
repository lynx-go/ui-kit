import { Link, useMatchRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * AppShell（shell 块）—— 应用骨架：Sidebar（navSections 单源）+ 主区。
 * navSections 是数据 prop（加页面 = 加一条路径引用），不是框架注册。
 */
export interface NavSection {
  label: string;
  items: ReadonlyArray<{ label: string; to: string }>;
}

export interface AppShellProps {
  brand?: string;
  nav: ReadonlyArray<NavSection>;
  children: ReactNode;
}

export function AppShell({ brand = "fleet-ui", nav, children }: AppShellProps) {
  const matchRoute = useMatchRoute();
  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel/40">
        <div className="px-4 py-4 text-sm font-semibold tracking-wide text-accent">{brand}</div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
          {nav.map((section) => (
            <div key={section.label}>
              <div className="px-2 py-1 text-[11px] font-medium tracking-wider text-muted uppercase">
                {section.label}
              </div>
              <ul>
                {section.items.map((item) => {
                  const active = matchRoute({ to: item.to, fuzzy: true });
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        className={cn(
                          "block rounded-md px-2 py-1.5 text-sm hover:bg-panel-2",
                          active ? "bg-panel-2 text-fg" : "text-muted",
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
