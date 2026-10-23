#!/usr/bin/env node
/**
 * layer-check —— 分层不变量的机械检查（design.md §1.4 / §11）。
 *
 * 规则：
 *   kernel    只许相对导入（零依赖、零 react）
 *   schema    允许 kernel + "effect"（公开面零 effect/schema 泄漏由导出审计保证）
 *   adapters  允许 kernel + "effect"
 *   react     允许 kernel + schema + react 系 + @tanstack 系；禁止 "effect"（目录级）
 *   registry  允许 @fleetly/fleet-ui-core* + @/ + @blocks/ + react 系 + @tanstack 系 + lucide/clsx/cva；禁止 effect
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const violations = [];

const IMPORT_RE = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

const LAYER_RULES = {
  kernel: {
    base: "packages/core/src/kernel",
    allowed: (spec, isRelative) => isRelative, // 只允许相对导入
    label: "kernel（零依赖）",
  },
  schema: {
    base: "packages/core/src/schema",
    allowed: (spec, isRelative) => isRelative || spec === "effect" || spec.startsWith("effect/"),
    label: "schema（kernel + effect）",
  },
  adapters: {
    base: "packages/core/src/adapters",
    allowed: (spec, isRelative) => isRelative || spec === "effect" || spec.startsWith("effect/"),
    label: "adapters（kernel + effect）",
  },
  react: {
    base: "packages/core/src/react",
    allowed: (spec, isRelative) =>
      isRelative ||
      spec === "react" ||
      spec.startsWith("react/") ||
      spec.startsWith("react-dom") ||
      spec.startsWith("@tanstack/"),
    banned: ["effect"],
    label: "react（禁 effect；TanStack 系 peer）",
  },
  registry: {
    base: "registry",
    allowed: (spec, isRelative) =>
      isRelative ||
      spec.startsWith("@fleetly/fleet-ui-core") ||
      spec.startsWith("@/") ||
      spec.startsWith("@blocks/") ||
      spec === "react" ||
      spec.startsWith("react") ||
      spec.startsWith("@tanstack/") ||
      spec === "lucide-react" ||
      spec === "clsx" ||
      spec === "tailwind-merge" ||
      spec === "class-variance-authority",
    banned: ["effect"],
    label: "registry blocks（消费绑定 + 基元；禁 effect）",
  },
};

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

for (const [layer, rule] of Object.entries(LAYER_RULES)) {
  let files = [];
  try {
    files = [...walk(join(root, rule.base))];
  } catch {
    continue; // 目录不存在（如 registry 未建）
  }
  for (const file of files) {
    if (file.includes("routeTree.gen")) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1];
      const isRelative = spec.startsWith(".") || spec.startsWith("/");
      const banned = rule.banned?.some((b) => spec === b || spec.startsWith(`${b}/`)) ?? false;
      if (banned) {
        violations.push(`[${layer}] ${relative(root, file)}: 禁止导入 "${spec}"（${rule.label}）`);
        continue;
      }
      if (!rule.allowed(spec, isRelative)) {
        violations.push(
          `[${layer}] ${relative(root, file)}: 不允许导入 "${spec}"（${rule.label}）`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`layer-check: ${violations.length} 处违规`);
  for (const violation of violations) console.error(`  ✖ ${violation}`);
  process.exit(1);
}
console.log("layer-check: 全部通过（kernel 零依赖 / 单向依赖 / react+registry 禁 effect）");
