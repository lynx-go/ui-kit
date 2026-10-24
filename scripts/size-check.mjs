#!/usr/bin/env node
/**
 * size-check —— bundle 预算机械门（design.md §11）。
 *
 * /adapters 入口 rolldown 打包（ESM + minify，peer 依赖外置——react/@tanstack 由消费方
 * 自带；effect 是真依赖，tree-shake 后计入）→ zlib gzip 计量。超预算非零退出。
 */
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";

const BUDGET_BYTES = 35 * 1024;
const EXTERNAL = [/^react/, /^react-dom/, /^@tanstack\//];

const input = new URL("../packages/ui-kit/src/adapters/index.ts", import.meta.url).pathname;
const bundle = await rolldown({
  input,
  external: (id) => EXTERNAL.some((re) => re.test(id)),
});
const { output } = await bundle.generate({ format: "esm", minify: true });
const code = output
  .filter((chunk) => chunk.type === "chunk")
  .map((chunk) => chunk.code)
  .join("\n");
await bundle.close();

const gzipBytes = gzipSync(Buffer.from(code), { level: 9 }).length;
const kB = (gzipBytes / 1024).toFixed(1);
const budgetkB = (BUDGET_BYTES / 1024).toFixed(0);

if (gzipBytes > BUDGET_BYTES) {
  console.error(`size-check: FAIL — /adapters ${kB} kB gzip > ${budgetkB} kB budget`);
  process.exit(1);
}
console.log(`size-check: ok — /adapters ${kB} kB gzip ≤ ${budgetkB} kB budget`);
