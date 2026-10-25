import type { ReactFormExtendedApi } from "@tanstack/react-form";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";

/**
 * TextField / SelectField（command 块）—— TanStack Form 的字段接线。
 * 字段级错误（含 onSubmit 返回的 fieldErrors 映射）经 meta.errors 渲染
 * （双注册校验器的重复条目去重——onChange+onSubmit 同挂时 TanStack 会
 * 产生双份，§12.10-⑤ 回流）。
 */

function FieldErrors({ errors }: { errors: ReadonlyArray<unknown> }) {
  const messages = [
    ...new Set(
      errors
        .map((error) =>
          typeof error === "string"
            ? error
            : error && typeof error === "object" && "message" in error
              ? String((error as { message: unknown }).message)
              : null,
        )
        .filter((message): message is string => message !== null),
    ),
  ];
  if (messages.length === 0) return null;
  return (
    <div className="space-y-0.5" role="alert">
      {messages.map((message) => (
        <p key={message} className="text-[11px] text-err">
          {message}
        </p>
      ))}
    </div>
  );
}

/** 宽化的 form api 类型（保留字段名类型，校验器泛型从简） */
type AnyFormApi<T extends object> = ReactFormExtendedApi<
  T,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>;

interface FieldShellProps {
  label: string;
  children: ReactNode;
}

function FieldShell({ label, children }: FieldShellProps) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export interface TextFieldProps<T extends object> {
  form: AnyFormApi<T>;
  name: string & keyof T;
  label: string;
  placeholder?: string;
  type?: "text" | "password" | "email";
  /** 必填客户端校验（空串/纯空白拒绝）；字符串 = 自定义文案（§12.10-⑤ 回流） */
  required?: boolean | string;
}

function requiredMessage(message: string) {
  return ({ value }: { value: unknown }): string | undefined =>
    value === undefined || value === null || String(value).trim() === "" ? message : undefined;
}

export function TextField<T extends object>({
  form,
  name,
  label,
  placeholder,
  type = "text",
  required = false,
}: TextFieldProps<T>) {
  return (
    <FieldShell label={label}>
      <form.Field
        name={name}
        validators={
          required
            ? {
                // onChange 即时反馈 + onSubmit 兜住"从未输入直接提交"
                onChange: requiredMessage(required === true ? "Required" : required),
                onSubmit: requiredMessage(required === true ? "Required" : required),
              }
            : undefined
        }
      >
        {(field: {
          state: { value: unknown; meta: { errors: ReadonlyArray<unknown> } };
          handleChange(value: unknown): void;
        }) => (
          <>
            <Input
              type={type}
              placeholder={placeholder}
              value={String(field.state.value ?? "")}
              onChange={(e) => field.handleChange(e.target.value)}
            />
            <FieldErrors errors={field.state.meta.errors} />
          </>
        )}
      </form.Field>
    </FieldShell>
  );
}

export interface SelectFieldProps<T extends object> {
  form: AnyFormApi<T>;
  name: string & keyof T;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** 必填客户端校验（空串拒绝）；字符串 = 自定义文案 */
  required?: boolean | string;
}

export function SelectField<T extends object>({
  form,
  name,
  label,
  options,
  required = false,
}: SelectFieldProps<T>) {
  return (
    <FieldShell label={label}>
      <form.Field
        name={name}
        validators={
          required
            ? {
                onChange: requiredMessage(required === true ? "Required" : required),
                onSubmit: requiredMessage(required === true ? "Required" : required),
              }
            : undefined
        }
      >
        {(field: {
          state: { value: unknown; meta: { errors: ReadonlyArray<unknown> } };
          handleChange(value: unknown): void;
        }) => (
          <>
            <select
              className="h-8 w-full rounded-md border border-line bg-panel px-2 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent"
              value={String(field.state.value ?? "")}
              onChange={(e) => field.handleChange(e.target.value)}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldErrors errors={field.state.meta.errors} />
          </>
        )}
      </form.Field>
    </FieldShell>
  );
}
