import { mockCollection } from "@lynx-go/uikit-core/adapters";
import { defineResource } from "@lynx-go/uikit-core/kernel";

/**
 * 时序 = collection（时间窗谓词）——design §7.1 推导的 demo 落地。
 *
 * 行形状 { id, t(桶 epoch), metric, series, value }；页面按 metric 谓词分图、
 * 时间窗走 t >= from 谓词。生成器确定性（种子散列 + 正弦），e2e 稳定。
 *
 * 服务端截断口径的模拟：cpu 序列面宣称 34 个副本、按上限回 12 个（含 2 个已停
 * 副本——活跃窗排序把它们排尾）。mem 面 2 序列。
 */

export type MetricName = "cpu" | "mem";

export interface MetricRow {
  id: string;
  /** 桶 epoch ms（全序列对齐同一 step） */
  t: number;
  metric: MetricName;
  series: string;
  value: number;
}

export const STEP_MS = 15_000;
/** 生成 2h 历史（30m 窗谓词真的过滤掉东西） */
export const HISTORY_MS = 2 * 60 * 60_000;

const MIB = 1024 * 1024;

/** 稳定散列（确定性噪声） */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function cpuValue(series: string, i: number, buckets: number): number {
  const seed = hash(series);
  const base = 18 + (seed % 46);
  const amp = 4 + (seed % 18);
  const wave = Math.sin((i / buckets) * Math.PI * 3 + (seed % 7)) * amp;
  const noise = (((seed * 31 + i * 17) % 13) - 6) * 0.7;
  return Math.max(0, Math.round((base + wave + noise) * 10) / 10);
}

const CPU_SERIES = Array.from({ length: 12 }, (_, i) => `replica-${i + 1}`);
/** 停更副本：末样本停在 10min 前（活跃窗 5min → 排序垫底，被渲染上限截下） */
const STOPPED_SERIES = new Set(["replica-11", "replica-12"]);
const STOPPED_AT_MS = 10 * 60_000;
const MEM_SERIES = ["api", "worker"] as const;

const buckets = HISTORY_MS / STEP_MS;
const end = Math.floor(Date.now() / STEP_MS) * STEP_MS;

const rows: MetricRow[] = [];
for (let i = 0; i < buckets; i += 1) {
  const t = end - (buckets - 1 - i) * STEP_MS;
  for (const series of CPU_SERIES) {
    if (STOPPED_SERIES.has(series) && t < end - STOPPED_AT_MS) continue;
    rows.push({
      id: `cpu-${series}-${t}`,
      t,
      metric: "cpu",
      series,
      value: cpuValue(series, i, buckets),
    });
  }
  for (const series of MEM_SERIES) {
    const workingSet = 96 + (hash(series) % 128) + Math.sin((i / buckets) * Math.PI * 2) * 24;
    rows.push({
      id: `mem-${series}-${t}`,
      t,
      metric: "mem",
      series,
      value: Math.round(workingSet * MIB),
    });
  }
}

const metricsMock = mockCollection(rows, { dialect: "offset", latencyMs: 120 });

export const metricsResource = defineResource({
  name: "metrics",
  getId: (row: MetricRow) => row.id,
  collection: metricsMock.collection,
});

/** cpu 序列面的服务端截断口径（模拟：命中 34、上限回 12） */
export const CPU_SERVER_CAP = { shown: CPU_SERIES.length, total: 34 } as const;

export const CPU_SERIES_KEYS: ReadonlyArray<string> = CPU_SERIES;
export const MEM_SERIES_KEYS: ReadonlyArray<string> = MEM_SERIES;

/** 量纲格式化（页面注入 MetricChart.formatValue——单位词表不进块） */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  if (value >= MIB) return `${(value / MIB).toFixed(0)} MiB`;
  return `${(value / 1024).toFixed(0)} KiB`;
}
