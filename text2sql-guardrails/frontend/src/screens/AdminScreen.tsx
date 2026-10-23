import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  BadgeCheck, Cpu, Flag, Gauge, LineChart, Scale, ShieldAlert, ShieldCheck, SlidersHorizontal,
  Sparkles, Star, Target, TriangleAlert, type LucideIcon,
} from "lucide-react";
import { ModelPoolPanel } from "../components/admin/ModelPoolPanel";
import { GoogleLinkPanel } from "../components/admin/GoogleLinkPanel";
import { useTweened } from "../hooks/useTweened";
import { ApiError, getAdminConfig, getAdminEvalMetrics, getAdminRlsDemo, getBlockedQueries } from "../api/client";
import { ErrorPanel } from "../components/ErrorPanel";
import { LoadingStatus, SkeletonLine, SkeletonList } from "../components/Skeleton";
import { ForbiddenPanel } from "../components/ForbiddenPanel";
import { AurocChart } from "../components/admin/AurocChart";
import { RlsRowCountChart } from "../components/admin/RlsRowCountChart";
import { SafetyLayerBreakdown } from "../components/admin/SafetyLayerBreakdown";
import { EASE, PageHeader, Panel, Reveal } from "../components/kit";
import { Badge } from "@/components/ui/badge";
import type { AdminConfigResponse, BlockedQueryItem, EvalMetricsResponse, RlsDemoResponse } from "../types/api";

function CountUp({ value }: { value: string }) {
  const m = /^(\d+(?:\.(\d+))?)(.*)$/s.exec(value);
  const n = useTweened(m ? parseFloat(m[1]) : 0, 1300, 0);
  if (!m) return <>{value}</>;
  return <>{n.toFixed(m[2]?.length ?? 0)}{m[3]}</>;
}

function StatTile({ label, value, hint, icon: Icon, i }: { label: string; value: string; hint?: string; icon: LucideIcon; i: number }) {
  return (
    <motion.div
      className="panel spotlight lift group flex min-h-[8.5rem] flex-col justify-between p-4 sm:p-5"
      initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.6, ease: EASE, delay: 0.1 + i * 0.05 }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs leading-snug text-muted-foreground">{label}</p>
        <Icon aria-hidden className="size-4 shrink-0 text-brand opacity-60 transition-all duration-500 group-hover:rotate-[-8deg] group-hover:opacity-100" />
      </div>
      <div className="mt-4">
        <p className="font-display text-[1.65rem] leading-none tabular-nums text-foreground break-words">
          <CountUp value={value} />
        </p>
        {hint && <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">{hint}</p>}
      </div>
    </motion.div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="group flex items-center justify-between gap-4 border-b border-dashed border-border py-2.5 text-xs last:border-0">
      <span className="text-soft transition-colors group-hover:text-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
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
    <Panel icon={ShieldAlert} tone="danger" title="Recent Blocked Queries (AST Guardrail Log)" meta={items && <Badge variant="danger">{items.length} logged</Badge>}>
      <p className="mb-4 max-w-prose text-xs leading-relaxed text-muted-foreground">
        Raw, unredacted SQL caught by safety guardrails — visible here to administrators only, never in user query
        responses.
      </p>

      {forbidden && <ForbiddenPanel what="the blocked-query log" />}
      {error && <ErrorPanel message={error} />}
      {!forbidden && !error && items === null && (
        <>
          <LoadingStatus label="Loading blocked queries" />
          <SkeletonList count={3} lines={2} />
        </>
      )}
      {items && items.length === 0 && <p className="animate-fade py-8 text-center text-sm text-muted-foreground">No blocked queries recorded yet.</p>}
      {items && items.length > 0 && (
        <ol className="space-y-2.5">
          {items.map((item, i) => (
            <motion.li
              key={item.query_id}
              className="group rounded-xl border border-border bg-background/40 p-4 transition-colors hover:border-[rgb(var(--danger-rgb)/0.35)] hover:bg-[rgb(var(--danger-rgb)/0.03)]"
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, ease: EASE, delay: Math.min(i, 8) * 0.04 }}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-foreground">{item.question}</p>
                <Badge variant="danger">Blocked</Badge>
              </div>
              <code className="code-surface mt-2.5 block truncate px-3 py-2 font-mono text-xs text-danger-text">{item.sql ?? "(no SQL generated)"}</code>
              <div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span className="text-danger-text">{item.blocked_reason}</span>
                <span aria-hidden>·</span>
                <span>{new Date(item.timestamp).toLocaleString()}</span>
              </div>
            </motion.li>
          ))}
        </ol>
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

  const wrap = "mx-auto max-w-7xl px-4 pt-8 sm:px-8 lg:px-10 lg:pt-12";

  if (forbidden) return <div className={wrap}><ForbiddenPanel what="the Admin screen" /></div>;
  if (error) return <div className={wrap}><ErrorPanel message={error} /></div>;

  if (!config) {
    return (
      <div className={`${wrap} space-y-6`}>
        <LoadingStatus label="Loading admin configuration" />
        <div className="space-y-2">
          <SkeletonLine w="w-56" h="h-8" />
          <SkeletonLine w="w-80" h="h-3" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="panel p-5">
              <SkeletonLine w="w-3/4" h="h-3" />
              <div className="mt-6"><SkeletonLine w="w-1/2" h="h-7" /></div>
            </div>
          ))}
        </div>
        <SkeletonList count={2} lines={3} />
      </div>
    );
  }

  const ev = config.eval_summary;
  const stats: { label: string; value: string; icon: LucideIcon; hint?: string }[] = [
    { label: "Execution Accuracy", value: ev.execution_accuracy.toFixed(3), icon: BadgeCheck },
    { label: "Fused AUROC", value: ev.fused_auroc.toFixed(3), icon: LineChart },
    { label: "Held-out ECE", value: ev.held_out_ece.toFixed(3), hint: "isotonic-calibrated", icon: SlidersHorizontal },
    { label: "Guardrail Block Rate", value: ev.guardrail_block_rate, icon: ShieldCheck },
    { label: "Destructive Queries Run", value: String(ev.destructive_queries_executed), icon: TriangleAlert },
    { label: "Adversarial Flags", value: String(ev.adversarial_executed_flags), hint: "raw heuristic", icon: Flag },
    { label: "Golden Set Size", value: String(ev.golden_set_size), icon: Star },
    { label: "Unique Answerable", value: String(ev.unique_answerable_questions), icon: Target },
  ];

  return (
    <div className={`${wrap} space-y-8`}>
      <PageHeader
        index="§ 04"
        eyebrow="Admin Console"
        title={<>{config.app_name} <span className="font-normal text-muted-foreground">v{config.version}</span></>}
        lede="System health, safety layer metrics, and model configuration."
        actions={
          <>
            <Badge variant="brand" className="h-7 px-2.5"><Cpu className="size-3" /> Model: {config.llm_model}</Badge>
            <Badge variant="muted" className="h-7 px-2.5"><Sparkles className="size-3" /> Admin Console</Badge>
          </>
        }
      />

      <section className="space-y-3">
        <p className="eyebrow flex items-center gap-2"><Gauge aria-hidden className="size-3.5 text-brand" /> Published Evaluation Benchmarks</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s, i) => <StatTile key={s.label} {...s} i={i} />)}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{ev.note}</p>
      </section>

      <Reveal><ModelPoolPanel /></Reveal>
      <Reveal><GoogleLinkPanel /></Reveal>

      {evalMetrics && (
        <div className="space-y-6">
          <Reveal>
            <AurocChart comparison={evalMetrics.auroc_comparison} ablationCells={evalMetrics.ablation_cells} perSignalAuroc={evalMetrics.per_signal_auroc} />
          </Reveal>
          {rlsDemo && (
            <Reveal><RlsRowCountChart principals={rlsDemo.principals} caveat={rlsDemo.caveat} /></Reveal>
          )}
          <Reveal><SafetyLayerBreakdown metrics={evalMetrics.safety_breakdown} /></Reveal>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Reveal>
          <Panel icon={ShieldCheck} title="AST Guardrail Parameters" className="h-full">
            <ConfigRow label="Default row limit" value={String(config.guardrail.default_row_limit)} />
            <ConfigRow label="Max subquery depth" value={String(config.guardrail.max_subquery_depth)} />
            <ConfigRow label="Statement timeout" value={`${config.guardrail.statement_timeout_ms} ms`} />
          </Panel>
        </Reveal>
        <Reveal delay={0.06}>
          <Panel icon={SlidersHorizontal} title="Detection & Calibration" className="h-full">
            <ConfigRow label="Back-translation check" value={config.detection.back_translation_enabled ? "enabled" : "disabled"} />
            <ConfigRow label="Multi-query agreement" value={config.detection.multi_query_enabled ? `enabled (N=${config.detection.multi_query_n})` : "disabled"} />
            <ConfigRow label="Fail-score cap" value={config.detection.fail_score_cap.toFixed(2)} />
            <ConfigRow label="Calibration status" value={config.detection.calibration_loaded ? "loaded (isotonic)" : "raw score"} />
          </Panel>
        </Reveal>
      </div>

      <Reveal>
        <Panel icon={Scale} title="Confidence-Fusion Weights">
          <div className="space-y-4">
            {Object.entries(config.detection.confidence_weights).map(([key, weight], i) => (
              <div key={key} className="group">
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="font-mono text-soft transition-colors group-hover:text-foreground">{key}</span>
                  <span className="font-mono tabular-nums text-brand">{weight.toFixed(2)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full origin-left rounded-full bg-gradient-to-r from-brand to-[var(--brand-bright)]"
                    style={{ width: `${weight * 100}%` }}
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, ease: EASE, delay: 0.1 + i * 0.07 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </Reveal>

      <Reveal><BlockedQueriesSection /></Reveal>
    </div>
  );
}
