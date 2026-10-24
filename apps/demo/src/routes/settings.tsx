import { Page } from "@blocks/shell/page";
import { SectionCard } from "@blocks/shell/section-card";
import { usePreference } from "@lynx-go/ui-kit";
import { createFileRoute } from "@tanstack/react-router";

// 设置页配方（design §6.3）：SectionCard × n × usePreference。此前设置折叠在
// 详情 tab（widgets/$id?tab=settings）——本页是独立页形态；两处是同一配方
// 的不同宿主（块不假设宿主）。偏好键即持久契约（localStorage 单源）。
export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const DENSITY = ["comfortable", "compact"] as const;
const TIMEZONES = ["UTC", "Asia/Shanghai", "America/New_York"] as const;

function SettingsPage() {
  const [density, setDensity] = usePreference<(typeof DENSITY)[number]>(
    "settings.density",
    "comfortable",
  );
  const [timezone, setTimezone] = usePreference<(typeof TIMEZONES)[number]>(
    "settings.timezone",
    "UTC",
  );
  const [autoscroll, setAutoscroll] = usePreference("settings.autoscroll", true);

  return (
    <Page
      title="Settings"
      description="设置页配方：SectionCard × n × usePreference（§6.3）——独立页形态；详情页 settings tab 是同一配方的 tab 宿主变体。"
      width="narrow"
    >
      <div className="space-y-4">
        <SectionCard
          title="Display"
          description="Density and timezone affect tables and timestamps across the console."
        >
          <div className="space-y-3">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Density</span>
              <select
                aria-label="Density"
                data-testid="pref-density"
                className="h-8 rounded-md border border-line bg-panel px-2 text-sm text-fg"
                value={density}
                onChange={(e) => setDensity(e.target.value as (typeof DENSITY)[number])}
              >
                {DENSITY.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>Timezone</span>
              <select
                aria-label="Timezone"
                data-testid="pref-timezone"
                className="h-8 rounded-md border border-line bg-panel px-2 text-sm text-fg"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value as (typeof TIMEZONES)[number])}
              >
                {TIMEZONES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </SectionCard>

        <SectionCard
          title="Streams"
          description="Live tails (logs / events) follow these defaults; per-page overrides are ephemeral."
        >
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>Auto-scroll to live tail</span>
            <input
              type="checkbox"
              data-testid="pref-autoscroll"
              checked={autoscroll}
              onChange={(e) => setAutoscroll(e.target.checked)}
              className="size-4 accent-[var(--color-accent)]"
            />
          </label>
        </SectionCard>

        <SectionCard
          title="Storage"
          description="偏好经 usePreference 落 localStorage（读坏回退缺省，不进错误通道）。"
        >
          <p className="text-xs text-muted">
            Keys: <code>settings.density</code> · <code>settings.timezone</code> ·{" "}
            <code>settings.autoscroll</code> —— 改一项后重载本页，值保持。
          </p>
        </SectionCard>
      </div>
    </Page>
  );
}
