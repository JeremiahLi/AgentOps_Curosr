"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EvaluatorMeta, FieldDescriptor } from "@/hooks/use-evaluators";

interface Props {
  meta: EvaluatorMeta;
  value: Record<string, unknown>;
  onChange: (key: string, val: unknown) => void;
}

function JsonField({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const text = typeof value === "string" ? value : value !== undefined ? JSON.stringify(value, null, 2) : "";
  return (
    <div>
      <Textarea
        placeholder={field.placeholder}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          if (v.trim() === "") {
            setError(null);
            return;
          }
          try {
            JSON.parse(v);
            setError(null);
          } catch {
            setError("不是合法 JSON");
          }
        }}
        className="min-h-[100px] font-mono text-xs"
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldDescriptor;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const current = value !== undefined ? value : field.default;

  switch (field.type) {
    case "number":
      return (
        <Input
          type="number"
          min={field.min}
          max={field.max}
          step={field.step}
          placeholder={field.placeholder}
          value={current === undefined || current === null ? "" : String(current)}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      );
    case "text":
      return (
        <Input
          placeholder={field.placeholder}
          value={current === undefined || current === null ? "" : String(current)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "textarea":
      return (
        <Textarea
          placeholder={field.placeholder}
          value={current === undefined || current === null ? "" : String(current)}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[70px]"
        />
      );
    case "select":
      return (
        <Select
          value={current === undefined || current === null ? "" : String(current)}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "boolean": {
      const on = current === true;
      return (
        <button
          type="button"
          onClick={() => onChange(!on)}
          className={`inline-flex h-8 w-full items-center rounded-md px-3 text-[13px] transition-colors ${
            on
              ? "bg-primary/10 text-primary ring-1 ring-primary/40"
              : "bg-muted/40 text-muted-foreground ring-1 ring-foreground/10 hover:ring-foreground/25"
          }`}
        >
          {on ? "开启" : "关闭"}
        </button>
      );
    }
    case "json":
      return <JsonField field={field} value={value} onChange={onChange} />;
    default:
      return null;
  }
}

/**
 * 规则评估器参数配置表单：按 configSchema 逐字段渲染。
 * 供「新建实验」页与「trace 抽样到实验」弹层共用。
 */
export function EvaluatorConfigForm({ meta, value, onChange }: Props) {
  const fields = meta.configSchema ?? [];
  if (fields.length === 0) return null;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {fields.map((field) => (
        <div
          key={field.key}
          className={field.type === "textarea" || field.type === "json" ? "md:col-span-2" : ""}
        >
          <label className="mb-1 flex items-center gap-1.5 text-[13px] font-medium">
            {field.label}
            {field.required && <span className="text-destructive">*</span>}
          </label>
          <Field field={field} value={value?.[field.key]} onChange={(val) => onChange(field.key, val)} />
          {field.helpText && (
            <p className="mt-1 text-xs text-muted-foreground">{field.helpText}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/** 校验必填字段是否就绪（供 canProceed / 提交前校验） */
export function isConfigValid(
  meta: EvaluatorMeta,
  config: Record<string, unknown> | undefined
): boolean {
  const fields = meta.configSchema ?? [];
  return fields.every((f) => {
    if (!f.required) return true;
    const v = config?.[f.key];
    if (v === undefined || v === null || v === "") return false;
    if (f.type === "json" && typeof v === "string") {
      try {
        JSON.parse(v);
      } catch {
        return false;
      }
    }
    return true;
  });
}
