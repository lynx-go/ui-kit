import { useEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** 原生 input checkbox 的样式包装（DataTable 行选择面）。indeterminate 是 DOM
 *  属性非 React prop——经 ref 同步（受控 checked；半选态仅视觉）。 */
export interface CheckboxProps extends Omit<ComponentProps<"input">, "type"> {
  indeterminate?: boolean;
}

export function Checkbox({ className, indeterminate, ...props }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate ?? false;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn("size-4 shrink-0 accent-fg disabled:opacity-50", className)}
      {...props}
    />
  );
}
