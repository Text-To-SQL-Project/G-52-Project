import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ModelPoolPanel } from "../components/admin/ModelPoolPanel";
import { gsap } from "gsap";
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
      {icon && <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--accent)" }}>{icon}</span>}
      <h3 className="font-mono text-xs font-semibold tracking-wider uppercase" style={{ color: "var(--text-secondary)" }}>
        {children}
      </h3>
    </div>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={className}
      style={{
        border: "1px solid var(--border-subtle)",
        borderRadius: "2px",
        padding: "24px",
      }}
    >
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
    <div
      className="flex flex-col justify-between py-4 transition-colors duration-150"
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        paddingRight: "16px",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.01)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-sans text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
        {icon && (
          <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--accent)", opacity: 0.5 }}>{icon}</span>
        )}
      </div>
      <div className="mt-2">
        <p
          className="font-display font-bold tracking-tight text-white"
          style={{ fontSize: "1.75rem", letterSpacing: "-0.03em" }}
        >
          {value}
        </p>
        {hint && <p className="mt-1 font-mono text-[10px]" style={{ color: "var(--text-ghost)" }}>{hint}</p>}
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between gap-4 py-2.5 text-xs"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="font-mono tabular-nums" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function BlockedQueriesSection() {
  const [items, setItems] = useState<BlockedQueryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (items && items.length > 0 && listRef.current) {
      gsap.fromTo(
        listRef.current.children,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.04, ease: "expo.out" }
      );
    }
  }, [items]);

  return (
    <Panel>
      <SectionLabel icon="shield">Recent Blocked Queries (AST Guardrail Log)</SectionLabel>
      <p className="mb-4 max-w-prose font-sans text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
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
        <p className="animate-fade py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No blocked queries recorded yet.
        </p>
      )}
      {items && items.length > 0 && (
        <div ref={listRef} className="space-y-0">
          {items.map((item) => (
            <div
              key={item.query_id}
              className="py-4 transition-colors"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(248, 113, 113, 0.02)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-sans text-sm font-medium" style={{ color: "var(--text-primary)" }}>{item.question}</p>
                <span
                  className="font-mono text-[10px] font-semibold uppercase"
                  style={{
                    padding: "2px 8px",
                    border: "1px solid rgba(248, 113, 113, 0.3)",
                    background: "rgba(248, 113, 113, 0.06)",
                    color: "var(--danger)",
                    borderRadius: "2px",
                  }}
                >
                  Blocked
                </span>
              </div>
              <div className="mt-2.5">
                <code
                  className="sql-editor-card block truncate px-3 py-2 font-mono text-xs"
                  style={{ color: "var(--danger)", opacity: 0.7 }}
                >
                  {item.sql ?? "(no SQL generated)"}
                </code>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 pt-2 font-mono text-[11px]" style={{ borderTop: "1px solid rgba(248, 113, 113, 0.08)", color: "var(--text-muted)" }}>
                <span style={{ color: "rgba(248, 113, 113, 0.7)" }}>{item.blocked_reason}</span>
                <span style={{ color: "var(--text-ghost)" }}>·</span>
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
      <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
        <ForbiddenPanel what="the Admin screen" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
        <ErrorPanel message={error} />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-5 py-10 sm:px-8 lg:px-10">
        <LoadingStatus label="Loading admin configuration" />
        <div className="space-y-2">
          <SkeletonLine w="w-56" h="h-4" />
          <SkeletonLine w="w-32" h="h-3" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} style={{ borderBottom: "1px solid var(--border-subtle)", padding: "16px 0" }}>
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
    <div className="mx-auto max-w-7xl space-y-8 px-5 py-10 sm:px-8 lg:px-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div>
          <h2
            className="font-display font-bold tracking-tight text-white"
            style={{ fontSize: "clamp(1.25rem, 3vw, 1.75rem)", letterSpacing: "-0.03em" }}
          >
            {config.app_name} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>v{config.version}</span>
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            System health, safety layer metrics, and model configuration
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="pill-tag px-3 py-1 font-mono text-xs">
            Model: {config.llm_model}
          </span>
          <span className="pill-tag px-3 py-1 font-mono text-xs">
            Admin Console
          </span>
        </div>
      </div>

      <ModelPoolPanel />

      {/* Eval stats — hairline-divided rows, not cards */}
      <section className="animate-rise space-y-3">
        <SectionLabel icon="analytics">Published Evaluation Benchmarks</SectionLabel>
        <div className="grid grid-cols-2 gap-x-8 sm:grid-cols-4">
          <StatTile label="Execution Accuracy" value={ev.execution_accuracy.toFixed(3)} icon="verified" />
          <StatTile label="Fused AUROC" value={ev.fused_auroc.toFixed(3)} icon="show_chart" />
          <StatTile label="Held-out ECE" value={ev.held_out_ece.toFixed(3)} hint="isotonic-calibrated" icon="tune" />
          <StatTile label="Guardrail Block Rate" value={ev.guardrail_block_rate} icon="shield" />
        </div>
        <div className="grid grid-cols-2 gap-x-8 sm:grid-cols-4">
          <StatTile label="Destructive Queries Run" value={String(ev.destructive_queries_executed)} icon="dangerous" />
          <StatTile label="Adversarial Flags" value={String(ev.adversarial_executed_flags)} hint="raw heuristic" icon="flag" />
          <StatTile label="Golden Set Size" value={String(ev.golden_set_size)} icon="star" />
          <StatTile label="Unique Answerable" value={String(ev.unique_answerable_questions)} icon="quiz" />
        </div>
        <p className="font-sans text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>{ev.note}</p>
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

      {/* Config sections */}
      <div className="animate-rise grid gap-8 sm:grid-cols-2 [animation-delay:70ms]">
        <Panel>
          <SectionLabel icon="security">AST Guardrail Parameters</SectionLabel>
          <ConfigRow label="Default row limit" value={String(config.guardrail.default_row_limit)} />
          <ConfigRow label="Max subquery depth" value={String(config.guardrail.max_subquery_depth)} />
          <ConfigRow label="Statement timeout" value={`${config.guardrail.statement_timeout_ms} ms`} />
        </Panel>

        <Panel>
          <SectionLabel icon="settings_suggest">Detection &amp; Calibration</SectionLabel>
          <ConfigRow label="Back-translation check" value={config.detection.back_translation_enabled ? "enabled" : "disabled"} />
          <ConfigRow
            label="Multi-query agreement"
            value={config.detection.multi_query_enabled ? `enabled (N=${config.detection.multi_query_n})` : "disabled"}
          />
          <ConfigRow label="Fail-score cap" value={config.detection.fail_score_cap.toFixed(2)} />
          <ConfigRow label="Calibration status" value={config.detection.calibration_loaded ? "loaded (isotonic)" : "raw score"} />
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
                  <span className="font-mono" style={{ color: "var(--text-secondary)" }}>{key}</span>
                  <span className="font-mono tabular-nums" style={{ color: "var(--accent)" }}>
                    {weight.toFixed(2)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden" style={{ background: "var(--border-subtle)", borderRadius: "1px" }}>
                  <div
                    className="h-full"
                    style={{
                      width: `${weight * 100}%`,
                      background: "var(--accent)",
                      borderRadius: "1px",
                      boxShadow: "0 0 8px var(--accent-glow)",
                      animationDelay: `${200 + i * 50}ms`,
                      transition: "width 0.7s var(--ease-expo)",
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
