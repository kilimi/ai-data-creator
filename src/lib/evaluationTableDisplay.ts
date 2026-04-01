/**
 * Shared formatting for Model Evaluation tables (Project Evaluations page & dataset tab).
 */

export function formatModelTypeShort(raw: string | undefined | null): string {
  if (!raw || raw === "Unknown") return "";
  return raw.replace(/\.(pt|pth|onnx)$/i, "");
}

/**
 * Model column: architecture (e.g. yolo11n) plus training task name when available.
 * Example: "yolo11n · Road signs v2"
 */
export function formatEvaluationModelDisplay(metadata: {
  model_type?: string;
  model_config?: { model?: string };
  training_task_name?: string;
} | null | undefined): string {
  const m = metadata || {};
  const raw =
    (m.model_type && m.model_type !== "Unknown" ? m.model_type : "") ||
    m.model_config?.model ||
    "";
  const typeShort = formatModelTypeShort(raw) || "—";
  const name = (m.training_task_name || "").trim();
  if (name) return `${typeShort} · ${name}`;
  return typeShort;
}

export type EvalMetrics = { precision: number; recall: number; f1: number };

export function getEvaluationRowMetrics(
  metadata: {
    results?: { precision?: number; recall?: number; f1_score?: number };
    aggregate_results?: { precision?: number; recall?: number; f1_score?: number };
  } | null | undefined,
  options: { isMultiDataset: boolean; aggregateStatus: string }
): EvalMetrics | null {
  const m = metadata || {};
  if (options.isMultiDataset) {
    const ar = m.aggregate_results;
    if (ar && typeof ar.precision === "number") {
      return {
        precision: ar.precision,
        recall: ar.recall ?? 0,
        f1: ar.f1_score ?? 0,
      };
    }
    return null;
  }
  const r = m.results;
  if (r && typeof r.precision === "number") {
    return {
      precision: r.precision,
      recall: r.recall ?? 0,
      f1: r.f1_score ?? 0,
    };
  }
  return null;
}

export function formatMetricPct(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
