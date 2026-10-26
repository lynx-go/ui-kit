import { collectionQueryOptions } from "@lynx-go/uikit-core";
import type { ApiError, Resource, Segment } from "@lynx-go/uikit-core/kernel";
import { textPredicate } from "@lynx-go/uikit-core/kernel";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * ReferenceSelect（query 块）—— 搜索式选择另一资源的记录（react-admin ReferenceInput 对应物）。
 * 搜索态是组件局部的（不进 URL）；走 collectionQueryOptions 直查（绕过 useCollection 是
 * 有意的组合——选择器的意图不值得占用地址栏）。
 */
export interface ReferenceSelectProps<T, ID> {
  resource: Resource<T, ID, any, any>;
  getLabel: (row: T) => string;
  getValue: (row: T) => ID;
  value: ID | null;
  onChange: (value: ID | null) => void;
  placeholder?: string;
  searchFields?: ReadonlyArray<string>;
}

export function ReferenceSelect<T, ID>({
  resource,
  getLabel,
  getValue,
  value,
  onChange,
  placeholder = "Search…",
  searchFields,
}: ReferenceSelectProps<T, ID>) {
  const [text, setText] = useState("");
  const fields = useMemo(
    () => searchFields ?? (resource.getId ? ["name", "id"] : ["id"]),
    [searchFields, resource],
  );

  const query = useQuery<Segment<T>, ApiError>({
    ...collectionQueryOptions(resource, {
      ...(text.trim() ? { predicate: textPredicate(fields, text) } : {}),
      window: { size: 20 },
    }),
    placeholderData: keepPreviousData,
    enabled: text.trim().length > 0 || value === null,
  });

  const options = query.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-1">
      <Input
        placeholder={placeholder}
        value={text}
        aria-label={placeholder}
        onChange={(e) => setText(e.target.value)}
      />
      {options.length > 0 ? (
        <ul className="max-h-48 overflow-auto rounded-md border border-line bg-panel">
          {options.map((row) => {
            const id = getValue(row);
            return (
              <li key={String(id)}>
                <button
                  type="button"
                  className={cn(
                    "w-full px-3 py-1.5 text-left text-sm hover:bg-panel-2",
                    value === id && "bg-panel-2 text-accent",
                  )}
                  onClick={() => onChange(id)}
                >
                  {getLabel(row)}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-1 text-xs text-muted">
          {text.trim() === "" ? "Type to search." : query.isPending ? "Searching…" : "No matches."}
        </p>
      )}
    </div>
  );
}
