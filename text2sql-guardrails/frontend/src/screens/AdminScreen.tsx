import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ApiError, getAdminConfig, getBlockedQueries } from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
import { LoadingStatus, SkeletonLine, SkeletonList } from "../components/Skeleton";
import type { AdminConfigResponse, BlockedQueryItem } from "../types/api";

function SectionLabel({ children }: { children: string }) {
  return (
    <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-white/45">
      {children}
    </h3>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.09] bg-[#0f1728]/85 px-5 py-4 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]">
      {children}
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.09] bg-[#0f1728]/85 px-4 py-3.5 transition-colors duration-200 hover:border-white/[0.16] hover:bg-[#16203a]/92">
      <p className="text-[11px] leading-snug text-white/40">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-[-0.01em] text-white">
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-white/30">{hint}</p>}
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.05] py-2.5 text-sm last:border-0">
      <span className="text-white/50">{label}</span>
      <span className="text-right font-mono text-[13px] tabular-nums text-white/90">{value}</span>
    </div>
  );
}

function BlockedQueriesSection() {
  const [items, setItems] = useState<BlockedQueryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBlockedQueries()
      .then((resp) => setItems(resp.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load blocked queries."));
  }, []);

  return (
    <Panel>
      <SectionLabel>Recent blocked queries</SectionLabel>
      <p className="mb-4 max-w-prose text-xs leading-relaxed text-white/35">
        Real, unredacted SQL the AST guardrail caught — visible here only, never in the Workspace
        response body (see Task 1). Across all sessions.
      </p>

      {error && <ErrorPanel message={error} />}
      {!error && items === null && (
        <>
          <LoadingStatus label="Loading blocked queries" />
          <SkeletonList count={3} lines={2} />
        </>
      )}
      {items && items.length === 0 && (
        <p className="animate-fade py-8 text-center text-sm text-white/35">
          No blocked queries yet.
        </p>
      )}
      {items && items.length > 0 && (
        <div className="space-y-2.5">
          {items.map((item, i) => (
            <div
              key={item.query_id}
              style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              className="animate-rise overflow-hidden rounded-xl border border-red-400/25 bg-red-500/[0.07] transition-colors duration-200 hover:border-red-400/40 hover:bg-red-500/[0.11]"
            >
              <p className="px-4 pt-3.5 text-sm leading-relaxed text-white/85">{item.question}</p>
              <div className="px-4 pt-2.5">
                <code className="block truncate rounded-lg border border-red-400/15 bg-[#020617]/60 px-3 py-2 font-mono text-xs text-red-200">
                  {item.sql ?? "(no SQL recorded)"}
                </code>
              </div>
              <p className="mt-3 border-t border-red-400/12 px-4 py-2 text-[11px] text-white/35">
                {item.blocked_reason}
                <span className="mx-1.5 text-white/15">·</span>
                <span className="tabular-nums">{new Date(item.timestamp).toLocaleString()}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </Panel>
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
      <div className="mx-auto max-w-5xl px-6 py-8 md:px-8">
        <ErrorPanel message={error} />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="mx-auto max-w-5xl space-y-5 px-6 py-8 md:px-8">
        <LoadingStatus label="Loading admin configuration" />
        <div className="space-y-2">
          <SkeletonLine w="w-56" h="h-4" />
          <SkeletonLine w="w-32" h="h-3" />
        </div>
        {/* Placeholder tiles match the eval grid below, so the page does not
            jump when the real numbers land. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.07] bg-[#0f1728]/70 px-4 py-3.5">
              <SkeletonLine w="w-3/4" h="h-3" />
              <div className="mt-3">
                <SkeletonLine w="w-1/2" h="h-6" />
              </div>
            </div>
          ))}
        </div>
        <SkeletonList count={2} lines={3} />
      </div>
    );
  }

  const ev = config.eval_summary;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 md:px-8">
      <div className="animate-fade">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">
          {config.app_name} <span className="font-normal text-white/35">v{config.version}</span>
        </h2>
        <p className="mt-0.5 text-xs text-white/35">
          Model <span className="font-mono text-white/50">{config.llm_model}</span>
        </p>
      </div>

      <section className="animate-rise">
        <SectionLabel>Published eval results</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Execution accuracy" value={ev.execution_accuracy.toFixed(3)} />
          <StatTile label="Fused AUROC" value={ev.fused_auroc.toFixed(3)} />
          <StatTile
            label="Held-out ECE"
            value={ev.held_out_ece.toFixed(3)}
            hint="isotonic-calibrated"
          />
          <StatTile label="Guardrail block rate" value={ev.guardrail_block_rate} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Destructive queries executed"
            value={String(ev.destructive_queries_executed)}
          />
          <StatTile
            label="Adversarial-executed flags"
            value={String(ev.adversarial_executed_flags)}
            hint="raw heuristic, see note"
          />
          <StatTile label="Golden set size" value={String(ev.golden_set_size)} />
          <StatTile
            label="Unique answerable questions"
            value={String(ev.unique_answerable_questions)}
          />
        </div>
        <p className="mt-3 max-w-prose text-xs leading-relaxed text-white/35">{ev.note}</p>
      </section>

      <div className="animate-rise grid gap-4 sm:grid-cols-2 [animation-delay:70ms]">
        <Panel>
          <SectionLabel>Guardrail config</SectionLabel>
          <ConfigRow label="Default row limit" value={String(config.guardrail.default_row_limit)} />
          <ConfigRow label="Max subquery depth" value={String(config.guardrail.max_subquery_depth)} />
          <ConfigRow label="Statement timeout" value={`${config.guardrail.statement_timeout_ms} ms`} />
        </Panel>

        <Panel>
          <SectionLabel>Detection config</SectionLabel>
          <ConfigRow
            label="Back-translation"
            value={config.detection.back_translation_enabled ? "enabled" : "disabled"}
          />
          <ConfigRow
            label="Multi-query agreement"
            value={
              config.detection.multi_query_enabled
                ? `enabled (N=${config.detection.multi_query_n})`
                : "disabled"
            }
          />
          <ConfigRow label="Fail-score cap" value={config.detection.fail_score_cap.toFixed(2)} />
          <ConfigRow
            label="Calibration"
            value={config.detection.calibration_loaded ? "loaded" : "not loaded (raw score)"}
          />
        </Panel>
      </div>

      <div className="animate-rise [animation-delay:140ms]">
        <Panel>
          <SectionLabel>Confidence-fusion weights</SectionLabel>
          <div className="space-y-3">
            {Object.entries(config.detection.confidence_weights).map(([key, weight], i) => (
              <div key={key}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-white/65">{key}</span>
                  <span className="shrink-0 font-mono tabular-nums text-white/45">
                    {weight.toFixed(2)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  {/* Same growth animation as the Workspace confidence bars:
                      these are weights, not verdicts, so blue throughout. */}
                  <div
                    className="animate-bar h-full rounded-full bg-blue-500"
                    style={{ width: `${weight * 100}%`, animationDelay: `${200 + i * 70}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="animate-rise [animation-delay:210ms]">
        <BlockedQueriesSection />
      </div>
    </div>
  );
}
