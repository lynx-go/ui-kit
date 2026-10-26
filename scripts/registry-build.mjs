#!/usr/bin/env node
/**
 * registry 构建脚本 —— 扫描 registry/{values,query,command,subscription,shell}/*.tsx
 * 产出 registry.json（shadcn registry 规范的最小实现）。
 * 消费方经 `shadcn add` 拷贝；target 落在消费方 components/lynx/<family>/。
 *
 * dependencies 声明：core semver + 块的裸导入扫描（design.md §6.1 MetricChart 裁决）。
 * UI 生态包（react/lucide/clsx…）假定消费方已有（vendored shadcn 生态）；其余裸包
 * （如 recharts）按 root devDependencies 的 range 追加——registry 拷贝制下落消费方。
 *
 * §12.7 修复的两类协议泄漏（构建期爆，不流进 registry.json）：
 * ① @lynx-go/uikit-core 的 workspace:* 解析值混入——core 依赖单源（CORE_RANGE 硬编码
 *   semver），块内 import kit 不再重复产出；
 * ② pnpm catalog: 协议（root devDeps 的 "catalog:default"）——读 pnpm-workspace.yaml
 *   catalogs 还原真 semver，解析不到即硬错（npm publish 0.1.0 事故同类教训）。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const families = ["values", "query", "command", "subscription", "shell"];

// core 依赖单源：kit 自身的 semver range（root devDeps 里是 workspace:*，不可外发）
const CORE_PACKAGE = "@lynx-go/uikit-core";
const CORE_RANGE = "^0.3";

// 生态基线包：vendored shadcn 模型下假定消费方已有，不进 dependencies
const ECOSYSTEM = [
  /^react(-dom)?$/,
  /^lucide-react$/,
  /^clsx$/,
  /^tailwind-merge$/,
  /^class-variance-authority$/,
  /^@tanstack\//,
  /^@blocks\//,
  /^@\//,
  /^\.\.?\//,
];

const rootDeps = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const rawRanges = {
  ...rootDeps.devDependencies,
  ...rootDeps.dependencies,
};

// pnpm catalog: 协议解析（pnpm-workspace.yaml catalogs.default.<pkg> = range）
function parseCatalogs() {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const catalog = {};
  let inDefaultCatalog = false;
  for (const line of yaml.split("\n")) {
    if (/^\s*default:/.test(line)) {
      inDefaultCatalog = true;
      continue;
    }
    if (inDefaultCatalog) {
      const m = /^\s{4,6}"?([\w@/.-]+)"?:\s*(\S+)\s*$/.exec(line);
      if (m) {
        catalog[m[1]] = m[2];
        continue;
      }
      if (/^\S/.test(line)) inDefaultCatalog = false; // 出 catalogs 段
    }
  }
  return catalog;
}

const catalog = parseCatalogs();
const knownRanges = {};
for (const [name, range] of Object.entries(rawRanges)) {
  if (range.startsWith("catalog:")) {
    const resolved = catalog[name];
    if (!resolved) {
      throw new Error(`registry-build: ${name} 声明 ${range} 但 pnpm-workspace.yaml catalogs 未登记——先补 catalog 或改直书版本`);
    }
    knownRanges[name] = resolved;
  } else if (!range.startsWith("workspace:")) {
    knownRanges[name] = range;
  }
}

const importPattern = /(?:import|export)\s[^"']*?from\s+"([^"]+)"/g;

function blockDependencies(source) {
  const packages = new Set();
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier.startsWith(".")) continue; // 相对导入不出现在块里，防御
    const bare = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (bare === CORE_PACKAGE) continue; // core 单源声明，块的 kit import 不重复产出
    if (ECOSYSTEM.some((re) => re.test(bare))) continue;
    packages.add(bare);
  }
  return [...packages]
    .filter((name) => knownRanges[name])
    .map((name) => `${name}@${knownRanges[name]}`);
}

const items = [];
for (const family of families) {
  let files = [];
  let sidecars = [];
  try {
    files = readdirSync(join(root, "registry", family)).filter((f) => f.endsWith(".tsx"));
    // .ts 伴生文件（纯函数旁置，如 metric-rows）：归属导入它的 .tsx 块（多文件块）
    sidecars = readdirSync(join(root, "registry", family)).filter((f) => f.endsWith(".ts"));
  } catch {
    continue;
  }
  for (const file of files) {
    const name = file.replace(/\.tsx$/, "");
    const source = readFileSync(join(root, "registry", family, file), "utf8");
    const stem = name.replace(/\.tsx$/, "");
    // 本块的多文件面：伴生 .ts 按相对导入归属（`./<stem>` 出现在块源里）
    const own = sidecars.filter((sc) => {
      const scStem = sc.replace(/\.ts$/, "");
      return scStem !== stem && new RegExp(`from "\\.\\/${scStem}"`).test(source);
    });
    items.push({
      name: `${family}-${name}`.replace(/([A-Z])/g, "-$1").toLowerCase(),
      type: "registry:block",
      title: name,
      files: [
        {
          path: join("registry", family, file),
          target: `components/lynx/${family}/${file}`,
          type: "registry:block",
        },
        ...own.map((sc) => ({
          path: join("registry", family, sc),
          target: `components/lynx/${family}/${sc}`,
          type: "registry:block",
        })),
      ],
      // 块依赖 core 的 semver range（Q8 裁决）+ 裸导入扫描出的三方包；UI 基元假定消费方已 vendored shadcn
      dependencies: [`${CORE_PACKAGE}@${CORE_RANGE}`, ...blockDependencies(source)].sort(),
      registryDependencies: [],
    });
  }
  // 孤儿伴生（无 .tsx 导入）= 构建期硬错：伴生文件必须属于某个块
  const claimed = new Set(items.flatMap((i) => i.files.map((f) => basename(f.path))));
  for (const sc of sidecars) {
    if (!claimed.has(sc)) {
      throw new Error(`registry build: orphan sidecar registry/${family}/${sc} — no block imports it`);
    }
  }
}

writeFileSync(join(root, "registry", "registry.json"), JSON.stringify({ items }, null, 2));
console.log(`registry build: ${items.length} blocks → registry/registry.json`);
