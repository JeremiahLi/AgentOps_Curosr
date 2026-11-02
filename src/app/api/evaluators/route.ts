import { NextResponse } from "next/server";
import { getAllEvaluators } from "@/lib/engine/experiment/evaluators";
import type { Evaluator } from "@/lib/engine/experiment/evaluator-types";

export async function GET() {
  const evaluators = getAllEvaluators().map((e: Evaluator) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    category: e.category,
    type: e.type,
    needsReference: e.needsReference ?? false,
    // 规则评估器附带参数描述（供前端渲染配置表单）；LLM 评估器为 null
    configSchema: e.type === "rule" ? e.configSchema : null,
  }));

  return NextResponse.json({ evaluators });
}
