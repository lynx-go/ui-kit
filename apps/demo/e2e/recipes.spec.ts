import { expect, test } from "@playwright/test";

test.describe("widget detail page (DetailPage hero × URL tabs)", () => {
  test("tabs land in URL; tab clicks replace history (back exits to the list)", async ({
    page,
  }) => {
    await page.goto("/widgets");
    await expect(page.getByRole("cell", { name: "widget-001", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // 行链接进详情（URL 即真相）
    await page.getByTestId("widget-detail-link").first().click();
    await expect(page).toHaveURL(/\/widgets\/widget-\d+/);
    await expect(page.getByTestId("detail-hero")).toBeVisible();

    // 切 tab：内容切换 + tab 进 URL
    await page.getByTestId("detail-tab-spec").click();
    await expect(page).toHaveURL(/tab=spec/);
    await expect(page.getByTestId("json-field")).toBeVisible();
    await expect(page.getByTestId("detail-tab-spec")).toHaveAttribute("aria-current", "page");

    await page.getByTestId("detail-tab-settings").click();
    await expect(page).toHaveURL(/tab=settings/);
    await expect(page.getByTestId("section-card").first()).toBeVisible();

    // replace 语义：连续切 tab 不堆历史——后退直接回列表（§2.1.1）
    await page.goBack();
    await expect(page).toHaveURL(/\/widgets$/);

    // overview = 缺省 tab：无参数进入即选中且不写 URL（schema 默认值语义）
    await page.goto("/widgets/widget-001");
    await expect(page.getByTestId("detail-tab-overview")).toHaveAttribute("aria-current", "page");
    await expect(page).not.toHaveURL(/tab=/);
  });

  test("deep link opens a tab directly (URL + defaults is the truth)", async ({ page }) => {
    await page.goto("/widgets/widget-002?tab=settings");
    await expect(page.getByTestId("detail-tab-settings")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("section-card").first()).toBeVisible();

    await page.goto("/widgets/widget-002?tab=spec");
    await expect(page.getByTestId("json-field")).toBeVisible();
    await expect(page.getByTestId("detail-tab-spec")).toHaveAttribute("aria-current", "page");
  });

  test("spec tab: JsonField applies valid JSON and shows field diff; bad JSON never writes", async ({
    page,
  }) => {
    await page.goto("/widgets/widget-003?tab=spec");
    await expect(page.getByTestId("json-field")).toBeVisible();

    // 坏 JSON：报错、不回写（值保持原样）
    await page.getByTestId("json-field-edit").click();
    await page.getByTestId("json-field-input").fill('{"name": "broken",');
    await page.getByTestId("json-field-apply").click();
    await expect(page.getByTestId("json-field-error")).toBeVisible();
    await expect(page.getByTestId("json-field-input")).toBeVisible(); // 仍停在编辑态

    // 合法 JSON：回写 + DiffView 出现差异行
    await page
      .getByTestId("json-field-input")
      .fill('{"name": "renamed-003", "status": "running", "replicas": 3, "owner": "owner-2"}');
    await page.getByTestId("json-field-apply").click();
    await expect(page.getByTestId("json-field-input")).toHaveCount(0); // 回到查看态
    await expect(page.getByTestId("diff-view")).toBeVisible();
    await expect(page.locator('[data-diff-path="name"]')).toBeVisible();
    // hero 标题经失效重取更新
    await expect(page.getByTestId("detail-hero")).toContainText("renamed-003");
  });
});

test.describe("quickstart wizard (Stepper × n forms × wait step)", () => {
  test("steps advance via form submits; wait stream reaches terminal state", async ({ page }) => {
    await page.goto("/quickstart");
    await expect(page.getByTestId("stepper")).toBeVisible();

    // 步 1：项目名（ensure 幂等）
    await page.getByLabel("Project name").fill("acme-prod");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByLabel("Workload name")).toBeVisible({ timeout: 5000 });
    // fresh-read：步 2 文案带出步 1 刚建的项目
    await expect(page.getByText("acme-prod").first()).toBeVisible();

    // 步 2：负载名 → 进入等待步骤
    await page.getByLabel("Workload name").fill("api");
    await page.getByRole("button", { name: "Create & deploy" }).click();
    await expect(page.getByTestId("wait-step")).toBeVisible({ timeout: 5000 });

    // 等待步骤：wait 流帧递进到终态（provisioning → healthy）
    await expect(page.getByTestId("wait-frame")).toContainText("provisioning", {
      timeout: 5000,
    });
    await expect(page.getByTestId("wizard-done")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("wizard-url")).toContainText("api.sslip.io");

    // 完成步骤在指示器上标记 done
    await expect(page.locator('[data-step-index="0"]')).toHaveAttribute("data-step-state", "done");
    await expect(page.locator('[data-step-index="3"]')).toHaveAttribute("data-step-state", "current");

    // 重开向导回到步 1
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByLabel("Project name")).toBeVisible();
  });
});

test.describe("overview dashboard (StatCard × n + MetricChart × n)", () => {
  test("charts render series; render cap discloses +N more and server cap note", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("stat-card")).toHaveCount(4);

    // cpu 图：12 序列、上限 10 → 披露 +2；服务端截断披露条也在。
    // 冷 dev server 首访要按需 transform recharts——图例出现即数据已到位
    const charts = page.getByTestId("metric-chart");
    await expect(charts).toHaveCount(2);
    await expect(charts.first().locator("b").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("metric-chart-more")).toContainText("+2 more series not shown", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("metric-chart-cap")).toContainText("12 of 34 series shown");

    // 时间窗谓词：切 15m 重查（图仍在、无空态）
    await page.getByTestId("chart-window").getByRole("button", { name: "15m" }).click();
    await expect(charts.first().locator("b").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("metric-chart-empty")).toHaveCount(0);
  });
});

test.describe("scope provider (context single-source, §12.10-③)", () => {
  test("bindings resolve scope from provider; not-ready suspends the query", async ({ page }) => {
    await page.goto("/scope-provider");
    // 就绪：proj-alpha 行到达（绑定未传 scope 字面量——Provider 单源）
    await expect(page.getByRole("row", { name: /Alpha widget 1/ })).toBeVisible();

    // 切项目 = 换 scope 键重取（proj-beta 行集）
    await page.getByLabel("Project scope").selectOption("proj-beta");
    await expect(page.getByRole("row", { name: /Beta widget 1/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Alpha widget 1/ })).toHaveCount(0);

    // 未就绪：查询停用（enabled: false，无新请求）；keepPrevious（绑定缺省）
    // 保留上一帧数据——停用不是清屏，是"冻结"。徽章转黄佐证状态。
    await page.getByLabel("Project scope").selectOption("");
    await expect(page.getByTestId("scope-state")).toHaveText(/not ready/);
    await expect(page.getByRole("row", { name: /Beta widget 1/ })).toBeVisible();
  });
});
