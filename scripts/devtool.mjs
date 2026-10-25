#!/usr/bin/env node
/**
 * devtool —— 拷贝制适配的机械化（design.md §12.7）：registry 块 → 消费方
 * components/fleet/<family>/ 的 token 方言重写 + vendored 头生成 + 判断题警告。
 *
 * 机械面（工具吃掉）：token 类名映射（词边界，连字符是 token 内部字符）、
 * cn import 规范化、vendored 头、依赖提示（registry.json 单源）。
 * 判断题（工具列出交接单，不自动）：warn/ok/accent 方言色、Badge tone→variant、
 * shadcn chart 基元随批拷入、文案、页壳结构剥离。
 *
 * 用法：
 *   node scripts/devtool.mjs list
 *   node scripts/devtool.mjs profiles
 *   node scripts/devtool.mjs copy <family>/<name> --to <consumer-root> \
 *        [--profile torchwood] [--note "批次/场景"] [--force]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const FAMILIES = ["values", "query", "command", "subscription", "shell"];

// demo 方言 token 词表（registry 源侧契约——新增方言 token 时同步登记）。
// 扫描器用枚举表而非生成式正则：映射目标（如 bg-muted）不得误报为未映射。
export const SOURCE_VOCAB = [
  "text-muted", "bg-panel", "bg-panel-2", "border-line", "text-fg", "text-err",
  "text-warn", "text-ok", "text-accent", "divide-line", "bg-warn", "border-warn",
  "border-accent", "bg-ok", "bg-err", "bg-accent", "border-err", "bg-line",
];

// 词边界：连字符是 token 内部字符——text-muted 不得误伤 text-muted-foreground，
// 也不得被 bg-panel 之外的 bg-panel-2 前缀命中。
function tokenRegex(token) {
  return new RegExp(`(?<![\\w-])${token}(?![\\w-])`, "g");
}

/**
 * token 映射引擎（纯函数，测试面）。
 * 返回 { output, applied: [{from,to,count}], unmapped: [{token,count}] }——
 * unmapped = 映射后源词表仍出现的方言 token（每块语境判断，警告面非错误）。
 */
export function applyTokenMap(source, tokenMap) {
  let output = source;
  const applied = [];
  for (const [from, to] of Object.entries(tokenMap)) {
    const re = tokenRegex(from);
    const count = (source.match(re) ?? []).length;
    if (count > 0) {
      output = output.replace(re, to);
      applied.push({ from, to, count });
    }
  }
  const unmapped = [];
  for (const token of SOURCE_VOCAB) {
    const count = (output.match(tokenRegex(token)) ?? []).length;
    if (count > 0) unmapped.push({ token, count });
  }
  return { output, applied, unmapped };
}

/** 判断题检测（不自动改——输出交接单）。 */
export function detectManualHints(source) {
  const hints = [];
  const toneCount = (source.match(/\btone=/g) ?? []).length;
  if (toneCount > 0) {
    hints.push(`Badge tone= ×${toneCount}——shadcn Badge 无 tone prop，需手工 variant+className 适配（参考 torchwood event-feed 先例）`);
  }
  if (source.includes("@/components/ui/chart")) {
    hints.push("依赖 shadcn chart 基元（components/ui/chart.tsx）——消费方缺则随批拷入（torchwood D 批先例）");
  }
  if (source.includes("@tanstack/table-core")) {
    hints.push("table-core 裸导入——消费方只装 react-table 时改主入口导入（上游改进候选）");
  }
  if (/mx-auto\s+max-w/.test(source)) {
    hints.push("块自带页壳（mx-auto max-w-*）——与消费方壳/页头单源架构法冲突时结构剥离（§12.1 痛点⑦）");
  }
  return hints;
}

/** vendored 头生成（既有批次的实证格式自动化）。 */
export function buildVendoredHeader({ sourcePath, kitVersion, date, note, profile, applied, unmapped, manualHints }) {
  const lines = [];
  lines.push(`// vendored from fleet-ui ${sourcePath} @${kitVersion}（${date}${note ? ` ${note}` : ""}）`);
  lines.push(`// 拷贝适配（scripts/devtool.mjs --profile ${profile.name}）：`);
  const mapNote = applied.length > 0
    ? applied.map((a) => `${a.from}→${a.to}`).join("、")
    : "本块无方言 token";
  lines.push(`// token 方言映射 ${mapNote}；cn 统一 ${profile.cnImport}。`);
  const manual = [
    ...unmapped.map((u) => `未映射方言 token ${u.token} ×${u.count}——每块语境判断（torchwood amber/emerald、fleetly status vars 先例）`),
    ...manualHints,
  ];
  if (manual.length > 0) {
    lines.push("// 手工步骤（判断题，工具不自动改）：");
    for (const item of manual) lines.push(`// - ${item}`);
  }
  lines.push("// 其余与上游一致。");
  return lines.join("\n");
}

function loadProfiles() {
  const dir = join(root, "scripts", "profiles");
  const out = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const profile = JSON.parse(readFileSync(join(dir, file), "utf8"));
    out[profile.name] = profile;
  }
  return out;
}

function kitVersion() {
  return JSON.parse(readFileSync(join(root, "packages", "ui-kit", "package.json"), "utf8")).version;
}

function registryDeps(sourcePath) {
  const registryJson = join(root, "registry", "registry.json");
  if (!existsSync(registryJson)) return null;
  const { items } = JSON.parse(readFileSync(registryJson, "utf8"));
  const item = items.find((it) => it.files.some((f) => f.path === sourcePath));
  return item ? item.dependencies : null;
}

function cmdList() {
  const profiles = loadProfiles();
  const total = [];
  for (const family of FAMILIES) {
    const dir = join(root, "registry", family);
    if (!existsSync(dir)) continue;
    const names = readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => f.replace(/\.tsx$/, ""));
    if (names.length === 0) continue;
    console.log(`${family}: ${names.join(", ")}`);
    total.push(...names);
  }
  console.log(`\n${total.length} blocks · profiles: ${Object.keys(profiles).join(", ")}`);
}

function cmdProfiles() {
  for (const profile of Object.values(loadProfiles())) {
    console.log(`${profile.name} — ${profile.note}`);
    console.log(`  cn → ${profile.cnImport}${profile.cnNote ? `（${profile.cnNote}）` : ""}`);
    const unmapped = SOURCE_VOCAB.filter((t) => !(t in profile.tokenMap));
    console.log(`  mapped ${Object.keys(profile.tokenMap).length} tokens；警告面（不映射，每块判断）: ${unmapped.join(", ")}`);
  }
}

function cmdCopy(blockRef, options) {
  const { to, profileName, note, force } = options;
  const match = /^([\w-]+)\/([\w-]+)$/.exec(blockRef);
  if (!match) die(`块引用形如 <family>/<name>，如 values/metric-chart（收到 "${blockRef}"）`);
  const [, family, name] = match;
  if (!FAMILIES.includes(family)) die(`family 须为 ${FAMILIES.join("/")}`);

  const sourcePath = join("registry", family, `${name}.tsx`);
  const sourceFile = join(root, sourcePath);
  if (!existsSync(sourceFile)) die(`块不存在：${sourcePath}（node scripts/devtool.mjs list 查看）`);
  const source = readFileSync(sourceFile, "utf8");

  const profiles = loadProfiles();
  const profile = profiles[profileName];
  if (!profile) die(`profile 不存在：${profileName}（可用：${Object.keys(profiles).join(", ")}）`);
  if (!to) die(`--to <consumer-root> 必填（拷贝目标仓根，如 ~/workspace/qiulin/torchwood/console）`);

  const target = join(resolve(to), "components", "fleet", family, `${name}.tsx`);
  if (existsSync(target) && !force) {
    die(`目标已存在：${target}（拷贝制的手工适配不可自动叠加——确认覆盖用 --force，或手工对照升级）`);
  }

  const { output, applied, unmapped } = applyTokenMap(source, profile.tokenMap);
  const manualHints = detectManualHints(source);
  const header = buildVendoredHeader({
    sourcePath,
    kitVersion: kitVersion(),
    date: new Date().toISOString().slice(0, 10),
    note,
    profile,
    applied,
    unmapped,
    manualHints,
  });

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${header}\n${output}`);

  console.log(`✓ ${sourcePath} → ${target}（profile ${profile.name}）`);
  for (const a of applied) console.log(`  token ${a.from}→${a.to} ×${a.count}`);
  for (const u of unmapped) console.log(`  ⚠ 未映射 ${u.token} ×${u.count}（手工判断）`);
  for (const hint of manualHints) console.log(`  ⚠ ${hint}`);
  const deps = registryDeps(sourcePath);
  if (deps && deps.length > 0) console.log(`  deps（registry.json）：${deps.join(" ")}`);
}

function die(message) {
  console.error(`devtool: ${message}`);
  process.exit(1);
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === "list") return cmdList();
  if (command === "profiles") return cmdProfiles();
  if (command === "copy") {
    const options = { to: null, profileName: "torchwood", note: "", force: false };
    const positional = [];
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === "--to") options.to = rest[++i];
      else if (arg === "--profile") options.profileName = rest[++i];
      else if (arg === "--note") options.note = rest[++i];
      else if (arg === "--force") options.force = true;
      else positional.push(arg);
    }
    if (positional.length !== 1) die("copy 需要 exactly 一个块引用：<family>/<name>");
    return cmdCopy(positional[0], options);
  }
  console.error("用法：node scripts/devtool.mjs <list|profiles|copy> …（design.md §12.7）");
  process.exit(command ? 1 : 0);
}

// CLI 直跑（测试 import 时不执行）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
