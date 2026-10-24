import { expect, test } from "@playwright/test";

test.describe("overview (custom content page)", () => {
  test("renders without any CustomPage machinery — plain route + Page shell", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Running", { exact: true })).toBeVisible();
  });

  test("useCan gate is fail-closed and follows the identity role", async ({ page }) => {
    await page.goto("/");

    // admin 身份：门开（pending 先行——fail-closed，占位可渲染但按钮不出）
    const gate = page.getByTestId("identity-gate");
    await expect(gate.getByRole("button", { name: "Delete all widgets" })).toBeVisible();

    // 切到 viewer：失效 record → 门关（denied 是渲染态，不是错误）
    await gate.getByRole("button", { name: "Switch to viewer" }).click();
    await expect(gate.getByTestId("gate-denied")).toBeVisible();
    await expect(gate.getByRole("button", { name: "Delete all widgets" })).toHaveCount(0);

    // 切回 admin：门重新打开
    await gate.getByRole("button", { name: "Switch to admin" }).click();
    await expect(gate.getByRole("button", { name: "Delete all widgets" })).toBeVisible();
  });
});

test.describe("widgets list (client-evaluated dialect, URL is the truth)", () => {
  test("pagination push/back and filter in URL", async ({ page }) => {
    await page.goto("/widgets");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toContainText("widget-");

    // 翻页 = push：page=2 进 URL
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page).toHaveURL(/page=2/);

    // 浏览器后退 = 上一页（历史栈即分页栈）
    await page.goBack();
    await expect(page).not.toHaveURL(/page=2/);

    // 过滤 = replace + 回第一页：q 进 URL、行集变化
    await page.getByLabel("Search").fill("widget-01");
    await page.getByLabel("Search").press("Enter");
    await expect(page).toHaveURL(/q=widget-01/);
    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByRole("row").nth(1)).toContainText("widget-01");

    // 状态过滤下拉（filter=status:eq:running）
    await page.getByLabel("Status").selectOption("running");
    await expect(page).toHaveURL(/status%3Aeq%3Arunning/);
  });

  test("four states: error state renders with retry after injected failure", async ({ page }) => {
    await page.goto("/widgets");
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("button", { name: "Simulate failure" }).click();
    await expect(page.getByRole("alert")).toContainText("Server error 503");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("empty state", async ({ page }) => {
    await page.goto("/widgets");
    await page.getByLabel("Search").fill("no-such-widget-xyz");
    await page.getByLabel("Search").press("Enter");
    await expect(page.getByText("No widgets match")).toBeVisible();
  });
});

test.describe("widgets keyset dialect (cursor in URL)", () => {
  test("next pushes cursor into URL; no total in pagination bar", async ({ page }) => {
    await page.goto("/widgets/keyset");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(/Showing \d+ rows/)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/cursor=/);
    await page.goBack();
    await expect(page).not.toHaveURL(/cursor=/);
  });
});

test.describe("reference select + batch resolution", () => {
  test("picking an owner filters the list and resolves owner names", async ({ page }) => {
    await page.goto("/owners");
    await page.getByLabel("Search owners…").fill("Ada");
    await page.getByRole("button", { name: "Ada Lovelace" }).click();
    await expect(page).toHaveURL(/owner%3Aeq%3Aowner-1/);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("row").nth(1)).toContainText("Ada Lovelace");
  });
});

test.describe("command line: create / rejection / delete", () => {
  test("create via form refreshes list by invalidation; rejection shows message-first box; delete confirms", async ({
    page,
  }) => {
    await page.goto("/widgets");

    // 新建 → ok → 默认失效刷新列表
    await page.getByRole("button", { name: "New widget" }).click();
    await page.getByLabel("Name").fill("widget-e2e");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("table")).toContainText("widget-e2e");

    // 拒绝（后端 code/message 形态）→ 表单错误盒；rejected 是结果不是异常
    await page.getByRole("button", { name: "New widget" }).click();
    await page.getByLabel("Name").fill("reject-me");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert").last()).toContainText("rejected by server");
    await page.getByRole("button", { name: "Cancel" }).click();

    // 行删除：确认框 → 命令 → 失效刷新
    const row = page.getByRole("row", { name: /widget-e2e/ });
    await row.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("table")).not.toContainText("widget-e2e");
  });
});
