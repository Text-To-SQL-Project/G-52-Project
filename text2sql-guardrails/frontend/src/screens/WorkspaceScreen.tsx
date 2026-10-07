import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MessageSquareQuote } from "lucide-react";
import { ApiError, getQueryConfidence, postQueryStream, type StreamEvent } from "../api/client";
import { toast } from "sonner";
import { DevConsole, ThinkingPanel, type LogLine, type StageDone } from "../components/LiveTrace";
import { OrbStage } from "../components/OrbStage";
import { ClarificationPanel } from "../components/ClarificationPanel";
import { ConfidenceCard } from "../components/ConfidenceCard";
import { LatencyMeter } from "../components/LatencyMeter";
import { ErrorPanel } from "../components/ErrorPanel";
import { GuardrailBanner } from "../components/GuardrailBanner";
import { QuestionInput } from "../components/QuestionInput";
import { ResultsTable } from "../components/ResultsTable";
import { SqlPanel } from "../components/SqlPanel";
import { StatusBanner } from "../components/StatusBanner";
import { WarningsList } from "../components/WarningsList";
import { EASE, Stagger, StaggerItem } from "../components/kit";
import { getSessionId } from "../hooks/useSessionId";
import type { Confidence, QueryResponse, UserRole } from "../types/api";

const ORB_COPY = {
  ready: { label: "Ready", detail: "Waiting for a question", dot: "var(--success)" },
  loading: { label: "Working", detail: "Running the guarded pipeline", dot: "var(--brand)" },
  success: { label: "Answered", detail: "Rows returned and scored", dot: "var(--success)" },
  blocked: { label: "Blocked", detail: "Stopped before execution", dot: "var(--destructive)" },
  refused: { label: "Refused", detail: "Destructive request declined", dot: "var(--destructive)" },
  error: { label: "Error", detail: "Something failed on the way", dot: "var(--destructive)" },
} as const;

interface Props {
  isAdmin?: boolean;
  role?: UserRole;
}

export function WorkspaceScreen({ isAdmin = false, role }: Props) {
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  // Final score from the background checks. Kept apart from `response` so
  // its arrival doesn't replay the response stack's entrance animation.
  const [final, setFinal] = useState<{ queryId: string; confidence: Confidence } | null>(null);
  const finalConfidence = final && final.queryId === response?.query_id ? final.confidence : null;

  useEffect(() => {
    if (!response?.confidence_pending || !response.confidence_ticket) return;
    let cancelled = false;
    getQueryConfidence(response.query_id, response.confidence_ticket)
      .then((update) => {
        if (!cancelled && update.confidence) setFinal({ queryId: response.query_id, confidence: update.confidence });
      })
      .catch(() => { /* keep the provisional score */ });
    return () => { cancelled = true; };
  }, [response]);

  // Live pipeline progress (everyone) and the developer log (server-gated).
  const [stages, setStages] = useState<StageDone[]>([]);
  const [dev, setDev] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);

  const onEvent = (e: StreamEvent) => {
    if (e.t === "hello") setDev(e.dev);
    else if (e.t === "stage") setStages((s) => [...s, { stage: e.stage, ms: e.ms }]);
    else if (e.t === "log") setLogs((l) => [...l, e]);
  };

  const run = async (question: string, sqlOverride?: string) => {
    setLoading(true);
    setClientError(null);
    setStages([]);
    setLogs([]);
    try {
      const result = await postQueryStream(
        { question, session_id: getSessionId(), max_rows: 1000, ...(sqlOverride ? { sql_override: sqlOverride } : {}) },
        onEvent,
      );
      setResponse(result);
      alertFor(result);
    } catch (e) {
      setResponse(null);
      const msg =
        e instanceof ApiError && e.status === 429
          ? `You're asking faster than the limit allows. Try again in ${e.retryAfter ?? 60} seconds.`
          : e instanceof ApiError ? e.message : "Unexpected client error.";
      setClientError(msg);
      if (!(e instanceof ApiError && e.status === 429)) toast.error("Couldn't reach the AI engine", { description: msg });
      else toast.warning("Slow down a little", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const alertFor = (r: QueryResponse) => {
    if (r.status === "blocked") {
      toast.error("Destructive operation blocked", {
        description: r.guardrail.blocked_reasons.join("; ") || "The AST guardrail stopped this query before it reached the database.",
      });
    } else if (r.status === "refused") {
      toast.error("Request refused", { description: "Writes, deletes and schema changes are never run from the workspace." });
    } else if (r.status === "error") {
      toast.error("The AI engine hit an error", { description: r.error_message ?? r.status_reason ?? "Please try again." });
    }
  };

  const orbStatus = loading
    ? "loading"
    : clientError || response?.status === "error"
      ? "error"
      : response?.status === "success"
        ? "success"
        : response?.status === "blocked" || response?.status === "refused"
          ? "blocked"
          : "ready";
  const orb = ORB_COPY[!loading && response?.status === "refused" ? "refused" : orbStatus];
  // Red alarm for anything destructive or broken; cleared while the next query runs.
  const alarm = !loading && (orbStatus === "blocked" || orbStatus === "error");

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 pt-8 sm:px-8 lg:px-10 lg:pt-12">
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-8">
          <QuestionInput onSubmit={(q) => run(q)} loading={loading} isAdmin={isAdmin} role={role} />
        </div>

        {/* Engine card: the orb plus live state. overflow clip: the halo is wider than the frame. */}
        <motion.aside
          className={`panel crop relative flex flex-col overflow-hidden lg:col-span-4 ${alarm ? "alarm" : ""}`}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.2 }}
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="eyebrow !text-[10px]">Engine</span>
            <span className="inline-flex items-center gap-2 font-mono text-[11px] text-soft">
              <span className="live-dot" style={{ "--dot": orb.dot } as React.CSSProperties} />
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={orb.label} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }}>
                  {orb.label}
                </motion.span>
              </AnimatePresence>
            </span>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-hidden px-10 py-8">
            <OrbStage status={orbStatus} className="max-w-[300px]" />
          </div>
          <p className="sr-only" aria-live="polite">{orb.detail}</p>
        </motion.aside>
      </div>

      {clientError && <ErrorPanel message={clientError} />}

      {alarm && (
        <motion.div
          key={response?.query_id ?? clientError}
          aria-hidden
          className="alarm-flash pointer-events-none fixed inset-0 z-[70]"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.6, 0] }}
          transition={{ duration: 1.3, times: [0, 0.15, 0.4, 1] }}
        />
      )}

      <AnimatePresence mode="wait">{loading && <ThinkingPanel key="running" done={stages} isAdmin={isAdmin} />}</AnimatePresence>

      {dev && <DevConsole lines={logs} live={loading} />}

      {response && !loading && (
        <Stagger key={response.query_id} className="space-y-6">
          {/* Status & timing. z-30: the latency popover must sit above later panels. */}
          <StaggerItem className="relative z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border pb-4">
            <div className="min-w-0 space-y-2.5">
              <p className="flex max-w-3xl items-start gap-2 text-sm text-muted-foreground">
                <MessageSquareQuote aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                <span className="line-clamp-2 text-soft">{response.question}</span>
              </p>
              <StatusBanner status={response.status} reason={response.status === "clarification" ? null : response.status_reason} />
            </div>
            {response.timings_ms && <LatencyMeter timings={response.timings_ms} />}
          </StaggerItem>

          {response.warnings.length > 0 && (
            <StaggerItem>
              <WarningsList warnings={response.warnings} />
            </StaggerItem>
          )}

          {response.status === "clarification" && response.clarification && (
            <StaggerItem>
              <ClarificationPanel
                key={response.query_id}
                clarification={response.clarification}
                question={response.question}
                onSelect={(q) => run(q)}
              />
            </StaggerItem>
          )}

          {response.status === "error" && (
            <StaggerItem>
              <ErrorPanel message={response.error_message} />
            </StaggerItem>
          )}

          {response.status === "blocked" && (
            <StaggerItem>
              <GuardrailBanner guardrail={response.guardrail} />
            </StaggerItem>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            {response.status === "success" && (
              <StaggerItem className="min-w-0 xl:col-span-7">
                <SqlPanel
                  sql={response.sql}
                  explanation={response.explanation}
                  tablesUsed={response.tables_used}
                  columnsUsed={response.columns_used}
                  onRerun={(editedSql) => run(response.question, editedSql)}
                  rerunning={loading}
                />
              </StaggerItem>
            )}
            <StaggerItem className={`min-w-0 ${response.status === "success" ? "xl:col-span-5" : "xl:col-span-12"}`}>
              <ConfidenceCard confidence={finalConfidence ?? response.confidence} />
            </StaggerItem>
          </div>

          <StaggerItem>
            <ResultsTable results={response.results} executed={response.status === "success"} />
          </StaggerItem>
        </Stagger>
      )}
    </div>
  );
}
