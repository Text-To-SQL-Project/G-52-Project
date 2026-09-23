import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  ApiError,
  getAdminConfig,
  getAdminEvalMetrics,
  getAdminRlsDemo,
  getBlockedQueries,
} from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
import { LoadingStatus, SkeletonLine, SkeletonList } from "../components/Skeleton";
import { ForbiddenPanel } from "../components/ForbiddenPanel";
import { AurocChart } from "../components/admin/AurocChart";
import { RlsRowCountChart } from "../components/admin/RlsRowCountChart";
import { SafetyLayerBreakdown } from "../components/admin/SafetyLayerBreakdown";
import type {
  AdminConfigResponse,
  BlockedQueryItem,
  EvalMetricsResponse,
  RlsDemoResponse,
} from "../types/api";

function SectionLabel({ children, icon }: { children: string; icon?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      {icon && <span className="material-symbols-outlined text-[16px] text-indigo-400">{icon}</span>}
      <h3 className="font-mono text-xs font-semibold tracking-wider text-white/60 uppercase">
        {children}
      </h3>
    </div>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`glass-card rounded-2xl p-6 ${className}`}>
      {children}
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: string;
}) {
  return (
    <div className="glass-card flex flex-col justify-between rounded-2xl p-4 transition-all duration-200 hover:border-white/[0.18] hover:bg-white/[0.06]">
      <div className="flex items-start justify-between gap-2">
        <p className="font-sans text-xs text-white/50">{label}</p>
        {icon && (
          <span className="material-symbols-outlined text-[16px] text-indigo-300/60">{icon}</span>
        )}
      </div>
      <div className="mt-3">
        <p className="font-display text-2xl font-bold tracking-tight text-white">{value}</p>
        {hint && <p className="mt-1 font-mono text-[10px] text-white/35">{hint}</p>}
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/[0.05] py-2.5 text-xs last:border-0">
      <span className="text-white/60">{label}</span>
      <span className="font-mono text-white/90 tabular-nums">{value}</span>
    </div>
  );
}

function BlockedQueriesSection() {
  const [items, setItems] = useState<BlockedQueryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    getBlockedQueries()
      .then((resp) => setItems(resp.items))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) {
          setForbidden(true);
          return;
        }
        setError(e instanceof ApiError ? e.message : "Failed to load blocked queries.");
      });
  }, []);

  return (
    <Panel>
      <SectionLabel icon="shield">Recent Blocked Queries (AST Guardrail Log)</SectionLabel>
      <p className="mb-4 max-w-prose font-sans text-xs leading-relaxed text-white/40">
        Raw, unredacted SQL caught by safety guardrails — visible here to administrators only,
        never in user query responses.
      </p>

      {forbidden && <ForbiddenPanel what="the blocked-query log" />}
      {error && <ErrorPanel message={error} />}
      {!forbidden && !error && items === null && (
        <>
          <LoadingStatus label="Loading blocked queries" />
          <SkeletonList count={3} lines={2} />
        </>
      )}
      {items && items.length === 0 && (
        <p className="animate-fade py-8 text-center text-sm text-white/35">
          No blocked queries recorded yet.
        </p>
      )}
      {items && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => (
            <div
              key={item.query_id}
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              className="animate-rise overflow-hidden rounded-xl border border-rose-500/25 bg-rose-950/20 p-4 transition-all hover:border-rose-500/40 hover:bg-rose-950/30"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-sans text-sm font-medium text-white/90">{item.question}</p>
                <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-300 uppercase">
                  Blocked
                </span>
              </div>
              <div className="mt-2.5">
                <code className="block truncate rounded-lg border border-rose-400/15 bg-black/40 px-3 py-2 font-mono text-xs text-rose-200">
                  {item.sql ?? "(no SQL generated)"}
                </code>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-rose-400/10 pt-2 font-mono text-[11px] text-white/40">
                <span className="text-rose-300/80">{item.blocked_reason}</span>
                <span className="mx-1 text-white/20">·</span>
                <span>{new Date(item.timestamp).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AdminScreen() {
  const [config, setConfig] = useState<AdminConfigResponse | null>(null);
  const [evalMetrics, setEvalMetrics] = useState<EvalMetricsResponse | null>(null);
  const [rlsDemo, setRlsDemo] = useState<RlsDemoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    Promise.all([getAdminConfig(), getAdminEvalMetrics(), getAdminRlsDemo()])
      .then(([cfg, metrics, rls]) => {
        setConfig(cfg);
        setEvalMetrics(metrics);
        setRlsDemo(rls);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) {
          setForbidden(true);
          return;
        }
        setError(e instanceof ApiError ? e.message : "Failed to load admin dashboard data.");
      });
  }, []);

  if (forbidden) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:px-8">
        <ForbiddenPanel what="the Admin screen" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:px-8">
        <ErrorPanel message={error} />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 md:px-8">
        <LoadingStatus label="Loading admin configuration" />
        <div className="space-y-2">
          <SkeletonLine w="w-56" h="h-4" />
          <SkeletonLine w="w-32" h="h-3" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="glass-card rounded-2xl p-4">
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
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 md:px-8">
      {/* Header Bar */}
      <div className="glass-card flex flex-wrap items-center justify-between gap-4 rounded-2xl px-6 py-4">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            {config.app_name} <span className="font-normal text-white/40">v{config.version}</span>
          </h2>
          <p className="font-sans text-xs text-white/50">
            System health, safety layer metrics, and model configuration
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="pill-tag-indigo rounded-full px-3 py-1 font-mono text-xs">
            Model: {config.llm_model}
          </span>
          <span className="pill-tag rounded-full px-3 py-1 font-mono text-xs">
            Admin Console
          </span>
        </div>
      </div>

      {/* Eval Results Grid */}
      <section className="animate-rise space-y-3">
        <SectionLabel icon="analytics">Published Evaluation Benchmarks</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Execution Accuracy"
            value={ev.execution_accuracy.toFixed(3)}
            icon="verified"
          />
          <StatTile label="Fused AUROC" value={ev.fused_auroc.toFixed(3)} icon="show_chart" />
          <StatTile
            label="Held-out ECE"
            value={ev.held_out_ece.toFixed(3)}
            hint="isotonic-calibrated"
            icon="tune"
          />
          <StatTile
            label="Guardrail Block Rate"
            value={ev.guardrail_block_rate}
            icon="g shield"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Destructive Queries Run"
            value={String(ev.destructive_queries_executed)}
            icon="dangerous"
          />
          <StatTile
            label="Adversarial Flags"
            value={String(ev.adversarial_executed_flags)}
            hint="raw heuristic"
            icon="flag"
          />
          <StatTile label="Golden Set Size" value={String(ev.golden_set_size)} icon="star" />
          <StatTile
            label="Unique Answerable"
            value={String(ev.unique_answerable_questions)}
            icon="quiz"
          />
        </div>
        <p className="font-sans text-xs leading-relaxed text-white/40">{ev.note}</p>
      </section>

      {/* Charts */}
      {evalMetrics && (
        <div className="animate-rise space-y-6 [animation-delay:50ms]">
          <AurocChart
            comparison={evalMetrics.auroc_comparison}
            ablationCells={evalMetrics.ablation_cells}
            perSignalAuroc={evalMetrics.per_signal_auroc}
          />
          {rlsDemo && (
            <RlsRowCountChart principals={rlsDemo.principals} caveat={rlsDemo.caveat} />
          )}
          <SafetyLayerBreakdown metrics={evalMetrics.safety_breakdown} />
        </div>
      )}

      {/* Config Grids */}
      <div className="animate-rise grid gap-6 sm:grid-cols-2 [animation-delay:70ms]">
        <Panel>
          <SectionLabel icon="security">AST Guardrail Parameters</SectionLabel>
          <ConfigRow
            label="Default row limit"
            value={String(config.guardrail.default_row_limit)}
          />
          <ConfigRow
            label="Max subquery depth"
            value={String(config.guardrail.max_subquery_depth)}
          />
          <ConfigRow
            label="Statement timeout"
            value={`${config.guardrail.statement_timeout_ms} ms`}
          />
        </Panel>

        <Panel>
          <SectionLabel icon="settings_suggest">Detection &amp; Calibration</SectionLabel>
          <ConfigRow
            label="Back-translation check"
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
          <ConfigRow
            label="Fail-score cap"
            value={config.detection.fail_score_cap.toFixed(2)}
          />
          <ConfigRow
            label="Calibration status"
            value={config.detection.calibration_loaded ? "loaded (isotonic)" : "raw score"}
          />
        </Panel>
      </div>

      {/* Weights */}
      <div className="animate-rise [animation-delay:120ms]">
        <Panel>
          <SectionLabel icon="balance">Confidence-Fusion Weights</SectionLabel>
          <div className="space-y-3.5 pt-1">
            {Object.entries(config.detection.confidence_weights).map(([key, weight], i) => (
              <div key={key}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="font-mono text-white/70">{key}</span>
                  <span className="font-mono text-indigo-300 tabular-nums">
                    {weight.toFixed(2)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="glow-button h-full rounded-full"
                    style={{
                      width: `${weight * 100}%`,
                      animationDelay: `${200 + i * 50}ms`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="animate-rise [animation-delay:160ms]">
        <BlockedQueriesSection />
      </div>
    </div>
  );
}
