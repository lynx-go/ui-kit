import { expect, test } from "@playwright/test";

test.describe("events composition page (backlog anchor × live follow)", () => {
  test("frames arrive from the anchor; pause freezes, resume continues from cursor", async ({
    page,
  }) => {
    await page.goto("/events");
    const rows = page.locator("li[data-key]");
    await expect(rows.first()).toBeVisible();
    const backlogCount = await rows.count();
    expect(backlogCount).toBeGreaterThanOrEqual(20);

    // live 帧从锚点（种子最新 seq 123）之后到达；最新在上
    await expect
      .poll(async () => Number(await rows.first().getAttribute("data-key")), { timeout: 8000 })
      .toBeGreaterThan(123);

    // 暂停：指示灯亮 + 行数冻结
    await page.getByTestId("pause-toggle").click();
    await expect(page.getByTestId("paused-indicator")).toBeVisible();
    const frozen = await rows.count();
    await page.waitForTimeout(2600);
    expect(await rows.count()).toBe(frozen);

    // 恢复：从游标续订，行数继续增长
    await page.getByTestId("pause-toggle").click();
    await expect(page.getByTestId("paused-indicator")).toHaveCount(0);
    await expect.poll(async () => rows.count(), { timeout: 8000 }).toBeGreaterThan(frozen);
  });

  test("410 gap: yellow bar appears; manual resync re-anchors (resyncs counter)", async ({
    page,
  }) => {
    await page.goto("/events");
    await expect
      .poll(async () => page.locator("li[data-key]").count(), { timeout: 8000 })
      .toBeGreaterThan(20);

    await page.getByRole("button", { name: "Simulate 410 gap" }).click();
    await expect(page.getByTestId("gap-bar")).toBeVisible();
    await expect(page.getByTestId("sub-status")).toHaveText("gapped");

    await page.getByTestId("resync").click();
    await expect(page.getByTestId("gap-bar")).toHaveCount(0);
    await expect(page.getByTestId("sub-status")).toHaveText("live");
    await expect(page.getByTestId("resynced-chip")).toContainText("re-synced ×1");

    // 重锚后帧继续（行数恢复增长）
    const after = await page.locator("li[data-key]").count();
    await expect
      .poll(async () => page.locator("li[data-key]").count(), { timeout: 8000 })
      .toBeGreaterThan(after);
  });

  test("kill connections: backoff exhausts → stalled; manual reconnect resets budget", async ({
    page,
  }) => {
    await page.goto("/events");
    await expect(page.getByTestId("sub-status")).toHaveText("live", { timeout: 8000 });
    const kill = page.getByRole("button", { name: "Kill connection" });
    const status = page.getByTestId("sub-status");

    // 三档退避 [400,800,1600]：连杀四刀（帧间隔 1.2s 内补刀，退避不归零）
    for (let round = 0; round < 3; round += 1) {
      await kill.click();
      await expect(status).toHaveText("reconnecting");
      await expect(status).toHaveText("live", { timeout: 5000 });
    }
    await kill.click();
    await expect(status).toHaveText("stalled", { timeout: 5000 });

    await page.getByTestId("reconnect").click();
    await expect(status).toHaveText("live", { timeout: 5000 });
  });
});

test.describe("logs page (ndjson tail + smart follow)", () => {
  test("follows the tail; scroll-up stops following with jump-to-live; server end → ended", async ({
    page,
  }) => {
    await page.goto("/logs");
    const log = page.getByRole("log");
    await expect(log).toBeVisible();
    // 首连回放 25 行历史 → 立即可滚动且贴底跟随
    await expect
      .poll(async () => log.locator("[data-line]").count(), { timeout: 8000 })
      .toBeGreaterThanOrEqual(25);

    const scrollTop = async () => log.evaluate((el) => el.scrollTop);
    await expect.poll(async () => (await scrollTop()) > 0, { timeout: 8000 }).toBe(true);

    // 上滚 → 停止跟随 + jump-to-live 出现；新帧到达但视口不动
    await log.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(page.getByTestId("jump-to-live")).toBeVisible();
    await page.waitForTimeout(1800);
    expect(await scrollTop()).toBe(0);

    // jump to live → 重新贴底（最后一行进入视口）
    await page.getByTestId("jump-to-live").click();
    await expect(page.getByTestId("jump-to-live")).toHaveCount(0);
    const lastLine = log.locator("[data-line]").last();
    await expect(lastLine).toBeVisible();

    // 服务端收流（终帧内容判据）→ ended；重启 → live
    await page.getByRole("button", { name: "Server finishes stream" }).click();
    await expect(page.getByTestId("log-status")).toHaveText("ended", { timeout: 5000 });
    await page.getByTestId("restart-stream").click();
    await expect(page.getByTestId("log-status")).toHaveText("live", { timeout: 5000 });
  });
});
