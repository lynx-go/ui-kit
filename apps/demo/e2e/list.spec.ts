import { expect, test } from "@playwright/test";

test.describe("overview (custom content page)", () => {
  test("renders without any CustomPage machinery — plain route + Page shell", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Running", { exact: true })).toBeVisible();
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
