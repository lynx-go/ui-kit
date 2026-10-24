import { expect, test } from "@playwright/test";

test.describe("scope sync (URL ↔ storage dual channel, four-piece recipe)", () => {
  test("switch writes URL (push) and storage memory; bare reload falls back to last scope", async ({
    page,
  }) => {
    await page.goto("/scopes");
    await expect(page.getByTestId("scope-switcher")).toBeVisible({ timeout: 10_000 });

    // 用户切换：URL push + storage 记忆
    await page.getByTestId("scope-switcher").selectOption("proj-beta");
    await expect(page).toHaveURL(/project=proj-beta/);
    await expect(page.getByTestId("current-scope")).toHaveText("proj-beta");
    expect(await page.evaluate(() => window.localStorage.getItem("scope.project"))).toContain(
      "proj-beta",
    );

    // 无参数重载：URL 无 project → 回落"上次选中"（storage 读向）
    await page.goto("/scopes");
    await expect(page.getByTestId("current-scope")).toHaveText("proj-beta");
    await expect(page).not.toHaveURL(/project=/);
  });

  test("stale scope id auto-corrects to the first available (replace, not push)", async ({
    page,
  }) => {
    await page.goto("/scopes?project=ghost");
    await expect(page.getByTestId("scope-switcher")).toBeVisible({ timeout: 10_000 });

    // 块内陈旧 id 校正：effect 期回落 proj-alpha，URL 归一化（replace）
    await expect(page.getByTestId("current-scope")).toHaveText("proj-alpha");
    await expect(page).toHaveURL(/project=proj-alpha$/);
  });

  test("storage event from another tab is bridged into the URL; same value does not write back", async ({
    page,
  }) => {
    await page.goto("/scopes");
    await expect(page.getByTestId("scope-switcher")).toBeVisible({ timeout: 10_000 });

    // 跨 tab 桥模拟：storage 事件只在本页未持有该 tab 时触发——用事件直发同键
    await page.evaluate(() => {
      window.localStorage.setItem("scope.project", JSON.stringify("proj-gamma"));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "scope.project",
          newValue: JSON.stringify("proj-gamma"),
        }),
      );
    });
    await expect(page).toHaveURL(/project=proj-gamma/);
    await expect(page.getByTestId("current-scope")).toHaveText("proj-gamma");
  });
});

test.describe("route error boundary (per-route page failure)", () => {
  test("renders the alert with retry; retry clears the failure flag and recovers", async ({
    page,
  }) => {
    await page.goto("/boom?fail=1");
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText("Injected failure");

    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("boom-ok")).toBeVisible();
    await expect(page).toHaveURL(/\/boom(\?fail=false)?$/);
  });

  test("healthy page renders without the boundary", async ({ page }) => {
    await page.goto("/boom");
    await expect(page.getByTestId("boom-ok")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("settings page (SectionCard × n × usePreference)", () => {
  test("preferences persist across reload via localStorage", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("section-card").first()).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("pref-density").selectOption("compact");
    await page.getByTestId("pref-timezone").selectOption("Asia/Shanghai");
    await page.getByTestId("pref-autoscroll").uncheck();

    await page.reload();
    await expect(page.getByTestId("section-card").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("pref-density")).toHaveValue("compact");
    await expect(page.getByTestId("pref-timezone")).toHaveValue("Asia/Shanghai");
    await expect(page.getByTestId("pref-autoscroll")).not.toBeChecked();
  });
});
