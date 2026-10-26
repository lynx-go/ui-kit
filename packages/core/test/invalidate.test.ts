import { describe, expect, test, vi } from "vitest";
import { createFrameInvalidator } from "../src/react/invalidate";

describe("createFrameInvalidator（useInvalidateOnFrame 的纯调度）", () => {
  test("throttle 0：每帧即射（缺省语义）", () => {
    const fire = vi.fn();
    const invalidator = createFrameInvalidator(fire);
    invalidator.ingest();
    invalidator.ingest();
    invalidator.ingest();
    expect(fire).toHaveBeenCalledTimes(3);
  });

  test("throttle 窗口内合并为 trailing 单射", async () => {
    const fire = vi.fn();
    const invalidator = createFrameInvalidator(fire, 50);
    invalidator.ingest();
    invalidator.ingest();
    invalidator.ingest();
    expect(fire).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(fire).toHaveBeenCalledTimes(1);

    // 窗口过后新帧重新开窗
    invalidator.ingest();
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(fire).toHaveBeenCalledTimes(2);
  });

  test("cancel 丢弃未射的窗口", async () => {
    const fire = vi.fn();
    const invalidator = createFrameInvalidator(fire, 50);
    invalidator.ingest();
    invalidator.cancel();
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(fire).not.toHaveBeenCalled();
  });

  test("cancel 后可继续开窗（重建生命周期）", async () => {
    const fire = vi.fn();
    const invalidator = createFrameInvalidator(fire, 20);
    invalidator.ingest();
    invalidator.cancel();
    invalidator.ingest();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
