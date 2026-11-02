"use client";

import { useEffect, useState } from "react";

export interface FieldDescriptor {
  key: string;
  label: string;
  type: "number" | "text" | "textarea" | "select" | "boolean" | "json";
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  helpText?: string;
  options?: { label: string; value: string }[];
  min?: number;
  max?: number;
  step?: number;
}

export interface EvaluatorMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  type: "llm" | "rule";
  needsReference: boolean;
  configSchema: FieldDescriptor[] | null;
}

// 模块级缓存 + 去重请求，避免多页重复拉取
let cache: EvaluatorMeta[] | null = null;
let inflight: Promise<EvaluatorMeta[]> | null = null;

async function fetchEvaluators(): Promise<EvaluatorMeta[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetch("/api/evaluators")
      .then((r) => r.json())
      .then((d) => {
        cache = d.evaluators as EvaluatorMeta[];
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useEvaluators() {
  const [evaluators, setEvaluators] = useState<EvaluatorMeta[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let mounted = true;
    fetchEvaluators()
      .then((list) => {
        if (mounted) {
          setEvaluators(list);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const byId: Record<string, EvaluatorMeta> = Object.fromEntries(
    evaluators.map((e) => [e.id, e])
  );
  const nameOf = (id: string) => byId[id]?.name ?? id;

  return { evaluators, byId, nameOf, loading };
}
