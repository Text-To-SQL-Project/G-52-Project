import { useEffect, useState } from "react";
import { ApiError, getAdminConfig } from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
import type { AdminConfigResponse } from "../types/api";

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-white/30">{hint}</p>}
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-2 text-sm last:border-0">
      <span className="text-white/50">{label}</span>
      <span className="font-mono text-white/90">{value}</span>
    </div>
  );
}

export function AdminScreen() {
  const [config, setConfig] = useState<AdminConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminConfig()
      .then(setConfig)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load admin config."));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <ErrorPanel message={error} />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <p className="py-8 text-center text-sm text-white/30">Loading…</p>
      </div>
    );
  }

  const ev = config.eval_summary;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
      <div>
        <h2 className="text-sm font-medium text-white/70">
          {config.app_name} <span className="text-white/30">v{config.version}</span>
        </h2>
        <p className="text-xs text-white/30">Model: {config.llm_model}</p>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
          Published eval results
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Execution accuracy" value={ev.execution_accuracy.toFixed(3)} />
          <StatTile label="Fused AUROC" value={ev.fused_auroc.toFixed(3)} />
          <StatTile label="Held-out ECE" value={ev.held_out_ece.toFixed(3)} hint="isotonic-calibrated" />
          <StatTile label="Guardrail block rate" value={ev.guardrail_block_rate} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Destructive queries executed" value={String(ev.destructive_queries_executed)} />
          <StatTile
            label="Adversarial-executed flags"
            value={String(ev.adversarial_executed_flags)}
            hint="raw heuristic, see note"
          />
          <StatTile label="Golden set size" value={String(ev.golden_set_size)} />
          <StatTile label="Unique answerable questions" value={String(ev.unique_answerable_questions)} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-white/30">{ev.note}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Guardrail config</h3>
          <ConfigRow label="Default row limit" value={String(config.guardrail.default_row_limit)} />
          <ConfigRow label="Max subquery depth" value={String(config.guardrail.max_subquery_depth)} />
          <ConfigRow label="Statement timeout" value={`${config.guardrail.statement_timeout_ms} ms`} />
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Detection config</h3>
          <ConfigRow
            label="Back-translation"
            value={config.detection.back_translation_enabled ? "enabled" : "disabled"}
          />
          <ConfigRow
            label="Multi-query agreement"
            value={config.detection.multi_query_enabled ? `enabled (N=${config.detection.multi_query_n})` : "disabled"}
          />
          <ConfigRow label="Fail-score cap" value={config.detection.fail_score_cap.toFixed(2)} />
          <ConfigRow
            label="Calibration"
            value={config.detection.calibration_loaded ? "loaded" : "not loaded (raw score)"}
          />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
          Confidence-fusion weights
        </h3>
        <div className="space-y-2">
          {Object.entries(config.detection.confidence_weights).map(([key, weight]) => (
            <div key={key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-white/60">{key}</span>
                <span className="font-mono text-white/40">{weight.toFixed(2)}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: `${weight * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
