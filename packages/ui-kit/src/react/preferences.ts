import { useCallback, useState } from "react";

/**
 * usePreference —— localStorage + 编解码的通用受控状态（design.md §3 派生表）。
 * useState 形 API；读坏（旧版本残留/手改）回退缺省值，不抛错。
 * SavedQueriesList 等配方后排；双通道作用域同步（URL↔localStorage）是配方层四件套，不在此。
 */

export interface PreferenceCodec<T> {
  parse(raw: string): T;
  stringify(value: T): string;
}

const jsonCodec: PreferenceCodec<unknown> = {
  parse: (raw) => JSON.parse(raw) as unknown,
  stringify: (value) => JSON.stringify(value),
};

/** 纯读：raw 缺席或解析失败 → fallback（fail-safe，不进错误通道）。 */
export function decodePreference<T>(
  raw: string | null | undefined,
  fallback: T,
  codec?: PreferenceCodec<T>,
): T {
  if (raw === null || raw === undefined) return fallback;
  try {
    return codec ? codec.parse(raw) : (jsonCodec.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function encodePreference<T>(value: T, codec?: PreferenceCodec<T>): string {
  return codec ? codec.stringify(value) : jsonCodec.stringify(value);
}

export function usePreference<T>(
  key: string,
  fallback: T,
  codec?: PreferenceCodec<T>,
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() =>
    typeof window === "undefined"
      ? fallback
      : decodePreference(window.localStorage.getItem(key), fallback, codec),
  );

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(key, encodePreference(resolved, codec));
          } catch {
            // 私有模式/配额：偏好是锦上添花，写失败静默
          }
        }
        return resolved;
      });
    },
    [key, codec],
  );

  return [value, set] as const;
}
