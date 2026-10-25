// devtool 测试矩阵（node --test，design.md §12.7-9）：token 引擎边界/误伤/
// 未映射警告、头生成、判断题检测、profile 完备性、registry.json 依赖收敛、
// CLI 端到端（临时目录真拷贝）。
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const {
  SOURCE_VOCAB,
  applyTokenMap,
  buildVendoredHeader,
  detectManualHints,
} = await import("./devtool.mjs");

function loadProfile(name) {
  return JSON.parse(readFileSync(join(root, "scripts", "profiles", `${name}.json`), "utf8"));
}

test("token 引擎：词边界映射与计数", () => {
  const { output, applied } = applyTokenMap(
    '<p className="text-muted border-line">x</p>',
    loadProfile("torchwood").tokenMap,
  );
  assert.match(output, /text-muted-foreground/);
  assert.match(output, /border-border/);
  assert.equal(applied.length, 2);
});

test("token 引擎：不误伤映射目标形（text-muted-foreground 不被二次改写）", () => {
  const source = '<p className="text-muted-foreground">ok</p>';
  const { output, unmapped } = applyTokenMap(source, loadProfile("torchwood").tokenMap);
  assert.equal(output, source);
  assert.equal(unmapped.length, 0); // 目标语法的 -foreground 形不在源词表
});

test("token 引擎：bg-panel 不命中 bg-panel-2（连字符是 token 内部字符）", () => {
  const { applied } = applyTokenMap('className="bg-panel bg-panel-2"', loadProfile("torchwood").tokenMap);
  const panel = applied.find((a) => a.from === "bg-panel");
  const panel2 = applied.find((a) => a.from === "bg-panel-2");
  assert.equal(panel.count, 1);
  assert.equal(panel2.count, 1);
});

test("token 引擎：未映射方言 token 进警告面（bg-muted 目标不误报）", () => {
  const { output, unmapped } = applyTokenMap(
    'className="bg-panel-2 text-warn bg-warn/15"',
    loadProfile("torchwood").tokenMap,
  );
  assert.match(output, /bg-muted(?!-)/); // bg-panel-2 → bg-muted（非 bg-muted-foreground）
  const tokens = unmapped.map((u) => u.token);
  assert.ok(tokens.includes("text-warn"));
  assert.ok(tokens.includes("bg-warn")); // bg-warn/15 的词边界命中（/15 是修饰不属 token）
  assert.ok(!tokens.includes("bg-muted")); // 映射目标不得进警告面
});

test("判断题检测：tone=/chart 基元/页壳", () => {
  const hints = detectManualHints(
    '<Badge tone="ok">x</Badge><X import="chart"/>',
  );
  // tone= 检测独立验证；chart/table-core/页壳逐项
  assert.ok(detectManualHints('import { ChartContainer } from "@/components/ui/chart";').some((h) => h.includes("chart 基元")));
  assert.ok(detectManualHints('import type { RowData } from "@tanstack/table-core";').some((h) => h.includes("table-core")));
  assert.ok(detectManualHints('<div className="mx-auto max-w-5xl p-6">').some((h) => h.includes("页壳")));
  assert.ok(hints.some((h) => h.includes("tone=")));
});

test("头生成：源路径/版本/profile/适配清单/手工区", () => {
  const header = buildVendoredHeader({
    sourcePath: "registry/values/states.tsx",
    kitVersion: "0.1.1",
    date: "2026-10-25",
    note: "测试批次",
    profile: loadProfile("torchwood"),
    applied: [{ from: "text-muted", to: "text-muted-foreground", count: 3 }],
    unmapped: [{ token: "text-warn", count: 2 }],
    manualHints: ["Badge tone= ×1——…"],
  });
  assert.match(header, /vendored from @lynx-go\/ui registry\/values\/states\.tsx @0\.1\.1（2026-10-25 测试批次）/);
  assert.match(header, /--profile torchwood/);
  assert.match(header, /text-muted→text-muted-foreground/);
  assert.match(header, /手工步骤/);
  assert.match(header, /未映射方言 token text-warn ×2/);
});

test("头生成：无警告面时不出现手工区", () => {
  const header = buildVendoredHeader({
    sourcePath: "registry/x/y.tsx",
    kitVersion: "0.1.1",
    date: "2026-10-25",
    note: "",
    profile: loadProfile("torchwood"),
    applied: [],
    unmapped: [],
    manualHints: [],
  });
  assert.doesNotMatch(header, /手工步骤/);
});

test("profile 完备性：键 ⊆ 源词表；核心 7 形双 console 全映射；warn/ok/accent 是警告面", () => {
  const CORE = ["text-muted", "bg-panel", "bg-panel-2", "border-line", "divide-line", "text-fg", "text-err"];
  for (const name of ["fleetly", "torchwood"]) {
    const { tokenMap } = loadProfile(name);
    for (const key of Object.keys(tokenMap)) {
      assert.ok(SOURCE_VOCAB.includes(key), `${name}: 映射键 ${key} 不在源词表（防拼写假映射）`);
    }
    for (const token of CORE) {
      assert.ok(tokenMap[token], `${name}: 核心 token ${token} 未映射`);
    }
  }
  const torchwood = loadProfile("torchwood").tokenMap;
  assert.equal(torchwood["text-err"], "text-destructive");
  assert.equal(torchwood["bg-panel-2"], "bg-muted");
  const fleetly = loadProfile("fleetly").tokenMap;
  assert.equal(fleetly["text-err"], "text-[var(--status-danger)]");
  assert.equal(fleetly["bg-panel-2"], "bg-muted/50");
  for (const name of ["fleetly", "torchwood"]) {
    for (const warnish of ["text-warn", "bg-ok", "text-accent"]) {
      assert.ok(!(warnish in loadProfile(name).tokenMap), `${name}: ${warnish} 应留警告面（每块语境判断）`);
    }
  }
});

test("registry.json 依赖收敛：无 workspace:/catalog: 协议泄漏，core 单源", () => {
  const { items } = JSON.parse(readFileSync(join(root, "registry", "registry.json"), "utf8"));
  assert.ok(items.length >= 29);
  const deps = new Set(items.flatMap((it) => it.dependencies));
  for (const dep of deps) {
    assert.doesNotMatch(dep, /workspace:/, `协议泄漏：${dep}`);
    assert.doesNotMatch(dep, /catalog:/, `协议泄漏：${dep}`);
  }
  assert.ok(deps.has("@lynx-go/ui-kit@^0.2"));
  const kitCount = items.filter((it) =>
    it.dependencies.filter((d) => d.startsWith("@lynx-go/ui-kit")).length > 1,
  );
  assert.equal(kitCount.length, 0, "core 依赖单源（不混 workspace 解析值）");
});

test("CLI 端到端：copy 真块到临时目录（映射+头+警告面+不覆盖守卫）", () => {
  const tmp = mkdtempSync(join(root, "..", "devtool-e2e-"));
  try {
    // 1) torchwood profile 拷 event-feed（含 warn 系 → 警告面 + tone= 检测）
    const out = execFileSync(
      process.execPath,
      ["scripts/devtool.mjs", "copy", "subscription/event-feed", "--to", tmp, "--profile", "torchwood", "--note", "e2e"],
      { cwd: root, encoding: "utf8" },
    );
    assert.match(out, /⚠ 未映射/);
    assert.match(out, /tone=/);
    const target = join(tmp, "components", "lynx", "subscription", "event-feed.tsx");
    assert.ok(existsSync(target));
    const vendored = readFileSync(target, "utf8");
    assert.match(vendored, /^\/\/ vendored from @lynx-go\/ui registry\/subscription\/event-feed\.tsx @\d+\.\d+\.\d+/);
    assert.match(vendored, /text-muted-foreground/);
    // 代码体（头注释之后的 import 起）不得残留源方言 token——头注释里的
    // "text-muted→text-muted-foreground" 是映射文档，属合法出现。
    const body = vendored.slice(vendored.indexOf("\nimport"));
    assert.doesNotMatch(body, /(?<![\w-])text-muted(?![\w-])/);

    // 2) 重复拷贝默认拒绝（手工适配保护）
    let refused = false;
    try {
      execFileSync(
        process.execPath,
        ["scripts/devtool.mjs", "copy", "subscription/event-feed", "--to", tmp, "--profile", "torchwood"],
        { cwd: root, encoding: "utf8", stdio: "pipe" },
      );
    } catch {
      refused = true;
    }
    assert.ok(refused, "重复拷贝应拒绝（--force 例外）");

    // 3) fleetly profile 差异实证（text-err → status var）
    execFileSync(
      process.execPath,
      ["scripts/devtool.mjs", "copy", "values/states", "--to", tmp, "--profile", "fleetly", "--force"],
      { cwd: root, encoding: "utf8" },
    );
    const states = readFileSync(join(tmp, "components", "lynx", "values", "states.tsx"), "utf8");
    const statesBody = states.slice(states.indexOf("\nimport"));
    assert.match(statesBody, /text-\[var\(--status-danger\)\]/);
    assert.doesNotMatch(statesBody, /(?<![\w-])text-err(?![\w-])/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("list/profiles 命令面", () => {
  const list = execFileSync(process.execPath, ["scripts/devtool.mjs", "list"], { cwd: root, encoding: "utf8" });
  assert.match(list, /values: /);
  assert.match(list, /subscription: /);
  const profiles = execFileSync(process.execPath, ["scripts/devtool.mjs", "profiles"], { cwd: root, encoding: "utf8" });
  assert.match(profiles, /torchwood/);
  assert.match(profiles, /警告面/);
});
