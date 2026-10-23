#!/usr/bin/env node
/**
 * registry 构建脚本 —— 扫描 registry/{values,query,command,subscription,shell}/*.tsx
 * 产出 registry.json（shadcn registry 规范的最小实现）。
 * 消费方经 `shadcn add` 拷贝；target 落在消费方 components/fleet/<family>/。
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const families = ["values", "query", "command", "subscription", "shell"];

const items = [];
for (const family of families) {
  let files = [];
  try {
    files = readdirSync(join(root, "registry", family)).filter((f) => f.endsWith(".tsx"));
  } catch {
    continue;
  }
  for (const file of files) {
    const name = file.replace(/\.tsx$/, "");
    items.push({
      name: `${family}-${name}`.replace(/([A-Z])/g, "-$1").toLowerCase(),
      type: "registry:block",
      title: name,
      files: [
        {
          path: join("registry", family, file),
          target: `components/fleet/${family}/${file}`,
          type: "registry:block",
        },
      ],
      // 块依赖 core 的 semver range（Q8 裁决）；UI 基元假定消费方已 vendored shadcn
      dependencies: ["@fleetly/fleet-ui-kit@^0.1"],
      registryDependencies: [],
    });
  }
}

writeFileSync(join(root, "registry", "registry.json"), JSON.stringify({ items }, null, 2));
console.log(`registry build: ${items.length} blocks → registry/registry.json`);
