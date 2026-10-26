#!/usr/bin/env node
/**
 * devtool —— 拷贝制适配的机械化（design.md §12.7）：registry 块 → 消费方
 * components/lynx/<family>/ 的 token 方言重写 + vendored 头生成 + 判断题警告。
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
 *        [--profile torchwood] [--note "批次/场景"] [--force] [--dir <相对目录>]
 *   node scripts/devtool.mjs diff <family>/<name> | --all --to <consumer-root> \
 *        [--profile torchwood] [--dir <相对目录>] [--check]   # 升级同步对照（v2）
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
  lines.push(`// vendored from @lynx-go/uikit ${sourcePath} @${kitVersion}（${date}${note ? ` ${note}` : ""}）`);
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
  return JSON.parse(readFileSync(join(root, "packages", "core", "package.json"), "utf8")).version;
}

function registryItem(sourcePath) {
  const registryJson = join(root, "registry", "registry.json");
  if (!existsSync(registryJson)) return null;
  const { items } = JSON.parse(readFileSync(registryJson, "utf8"));
  return items.find((it) => it.files.some((f) => f.path === sourcePath)) ?? null;
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
  const { to, profileName, note, force, dir } = options;
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

  // 多文件块（registry files[]，含 .ts 伴生）：主文件 + 伴生全部拷贝；
  // 目标基目录缺省 registry 约定 components/lynx（torchwood --dir src/components/fleet）。
  const item = registryItem(sourcePath);
  const fileList = item ? item.files.map((f) => f.path) : [sourcePath];
  const baseDir = dir ?? join("components", "lynx");

  const targets = fileList.map((rel) => {
    const relFromFamily = rel.split("/").slice(-2).join("/");
    return join(resolve(to), baseDir, relFromFamily);
  });
  const existing = targets.filter((t) => existsSync(t));
  if (existing.length > 0 && !force) {
    die(`目标已存在：${existing.join(", ")}（拷贝制的手工适配不可自动叠加——确认覆盖用 --force，或手工对照升级）`);
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

  mkdirSync(dirname(targets[0]), { recursive: true });
  writeFileSync(targets[0], `${header}\n${output}`);

  console.log(`✓ ${sourcePath} → ${targets[0]}（profile ${profile.name}）`);
  // 伴生文件（.ts 纯函数旁置等）：同头 + 同 token 映射，无手工提示面
  for (let i = 1; i < fileList.length; i += 1) {
    const sidecarSource = readFileSync(join(root, fileList[i]), "utf8");
    const mapped = applyTokenMap(sidecarSource, profile.tokenMap);
    writeFileSync(targets[i], `${header}\n${mapped.output}`);
    console.log(`✓ ${fileList[i]} → ${targets[i]}`);
  }
  for (const a of applied) console.log(`  token ${a.from}→${a.to} ×${a.count}`);
  for (const u of unmapped) console.log(`  ⚠ 未映射 ${u.token} ×${u.count}（手工判断）`);
  for (const hint of manualHints) console.log(`  ⚠ ${hint}`);
  const deps = item ? item.dependencies : null;
  if (deps && deps.length > 0) console.log(`  deps（registry.json）：${deps.join(" ")}`);
}

/** 剥离 vendored 头：跳过文件开头连续的 // 行与空行（头全是 // 注释行；
 * .ts 伴生无 import 行，首个非 // 行（如 /** 块注释）即代码体）。 */
export function stripVendoredHeader(vendored) {
  const lines = vendored.split("\n");
  let idx = 0;
  while (idx < lines.length && (lines[idx].startsWith("//") || lines[idx].trim() === "")) idx += 1;
  return idx >= lines.length ? vendored : lines.slice(idx).join("\n");
}

/**
 * 极简行级 diff（LCS DP，块级文件 ≤200 行 O(n·m) 足够）——diff v2 的核心
 * 纯函数。返回 { count, hunks }：count = 变更行数（+/- 合计），hunks 为
 * 统一风格片段 [{ aStart, bStart, lines: [{mark, text}] }]（上下文 2 行）。
 */
export function lineDiff(aText, bText, context = 2) {
  const a = aText.split("\n");
  const b = bText.split("\n");
  const n = a.length;
  const m = b.length;
  // LCS 长度表（滚动数组不可行——回溯需要全表；块级规模可承受）
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const marks = []; // {mark: " "|"-"|"+", text}
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      marks.push({ mark: " ", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      marks.push({ mark: "-", text: a[i] });
      i += 1;
    } else {
      marks.push({ mark: "+", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    marks.push({ mark: "-", text: a[i] });
    i += 1;
  }
  while (j < m) {
    marks.push({ mark: "+", text: b[j] });
    j += 1;
  }
  // 折叠为 hunks（变更行 ± context）
  const changed = marks.map((x) => x.mark !== " ");
  const hunks = [];
  let k = 0;
  while (k < marks.length) {
    if (!changed[k]) {
      k += 1;
      continue;
    }
    let end = k;
    // 从 end 向前看 context 窗口内还有变更行则继续扩展（窗口以 end 为锚——
    // 从 k 起全量 some 会吞并中间全部未变更行）
    while (end < marks.length && changed.slice(end, end + context + 1).some(Boolean)) end += 1;
    // hunk 边界扩展 context（前侧）
    const start = Math.max(0, k - context);
    hunks.push({ lines: marks.slice(start, end) });
    k = end;
  }
  return { count: changed.filter(Boolean).length, hunks };
}

function diffBlock(blockRef, options) {
  const { to, profileName, dir } = options;
  const match = /^([\w-]+)\/([\w-]+)$/.exec(blockRef);
  if (!match) die(`块引用形如 <family>/<name>（收到 "${blockRef}"）`);
  const [, family, name] = match;
  const sourcePath = join("registry", family, `${name}.tsx`);
  const item = registryItem(sourcePath);
  if (!existsSync(join(root, sourcePath))) die(`块不存在：${sourcePath}`);
  const profiles = loadProfiles();
  const profile = profiles[profileName];
  if (!profile) die(`profile 不存在：${profileName}`);
  const baseDir = dir ?? join("components", "lynx");

  const results = [];
  for (const file of item ? item.files : [{ path: sourcePath }]) {
    const base = file.path.split("/").slice(-2).join("/");
    const upstream = applyTokenMap(readFileSync(join(root, file.path), "utf8"), profile.tokenMap).output;
    const target = join(resolve(to), baseDir, base);
    if (!existsSync(target)) {
      results.push({ base, status: "missing" });
      continue;
    }
    const vendoredBody = stripVendoredHeader(readFileSync(target, "utf8"));
    const diff = lineDiff(upstream, vendoredBody);
    results.push({ base, status: diff.count === 0 ? "in-sync" : "drifted", diff });
  }
  return results;
}

function cmdDiff(blockRef, options) {
  const results = diffBlock(blockRef, options);
  let drift = 0;
  for (const r of results) {
    if (r.status === "missing") {
      console.log(`✗ ${r.base}——消费方无此副本`);
      drift += 1;
      continue;
    }
    if (r.status === "in-sync") {
      console.log(`✓ ${r.base}——与上游一致（机械面归一后）`);
      continue;
    }
    drift += 1;
    console.log(`~ ${r.base}——${r.diff.count} 行差异（手工层或上游更新）：`);
    for (const hunk of r.diff.hunks) {
      for (const line of hunk.lines) console.log(`  ${line.mark}${line.text}`);
    }
  }
  if (options.check && drift > 0) process.exitCode = 1;
  return drift;
}

function cmdDiffAll(options) {
  const profiles = loadProfiles();
  const profile = profiles[options.profileName];
  if (!profile) die(`profile 不存在：${options.profileName}`);
  const baseDir = options.dir ?? join("components", "lynx");
  const consumerRoot = resolve(options.to);
  let drift = 0;
  let checked = 0;
  const localOnly = [];
  for (const family of FAMILIES) {
    const dirPath = join(consumerRoot, baseDir, family);
    if (!existsSync(dirPath)) continue;
    for (const file of readdirSync(dirPath)) {
      if (!/\.tsx$/.test(file)) continue; // .ts 伴生随主块 diff 覆盖（多文件块）
      const sourcePath = join("registry", family, file);
      if (!existsSync(join(root, sourcePath))) {
        localOnly.push(join(family, file));
        continue;
      }
      checked += 1;
      drift += cmdDiff(`${family}/${file.replace(/\.tsx$/, "")}`, options);
    }
  }
  console.log(`\n${checked} 块核对，${drift > 0 ? `${drift} 处漂移` : "全部一致"}${localOnly.length > 0 ? `；本地新文件（无上游对应，不计漂移）：${localOnly.join("、")}` : ""}`);
  if (options.check && drift > 0) process.exitCode = 1;
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
    const options = { to: null, profileName: "torchwood", note: "", force: false, dir: null };
    const positional = [];
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === "--to") options.to = rest[++i];
      else if (arg === "--profile") options.profileName = rest[++i];
      else if (arg === "--note") options.note = rest[++i];
      else if (arg === "--force") options.force = true;
      else if (arg === "--dir") options.dir = rest[++i];
      else positional.push(arg);
    }
    if (positional.length !== 1) die("copy 需要 exactly 一个块引用：<family>/<name>");
    return cmdCopy(positional[0], options);
  }
  if (command === "diff") {
    // diff v2（§12.10 余款）：上游块 vs 消费方副本的语义对照——token 映射与
    // vendored 头归一后 diff，残余即手工层或上游更新（升级同步的交接单）。
    const options = { to: null, profileName: "torchwood", dir: null, check: false, all: false };
    const positional = [];
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i];
      if (arg === "--to") options.to = rest[++i];
      else if (arg === "--profile") options.profileName = rest[++i];
      else if (arg === "--dir") options.dir = rest[++i];
      else if (arg === "--check") options.check = true;
      else if (arg === "--all") options.all = true;
      else positional.push(arg);
    }
    if (!options.to) die("diff 需要 --to <consumer-root>（如 ~/workspace/qiulin/torchwood/console）");
    if (options.all) return cmdDiffAll(options);
    if (positional.length !== 1) die("diff 需要 exactly 一个块引用：<family>/<name>（或 --all 扫全量）");
    cmdDiff(positional[0], options);
    return undefined;
  }
  console.error("用法：node scripts/devtool.mjs <list|profiles|copy|diff> …（design.md §12.7/§12.10）");
  process.exit(command ? 1 : 0);
}

// CLI 直跑（测试 import 时不执行）
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
