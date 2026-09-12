import { useState } from "react";
import { ApiError, postQuery } from "../api/client";
import { ClarificationPanel } from "../components/ClarificationPanel";
import { ConfidenceCard } from "../components/ConfidenceCard";
import { ErrorPanel } from "../components/ErrorPanel";
import { GuardrailBanner } from "../components/GuardrailBanner";
import { QuestionInput } from "../components/QuestionInput";
import { ResultsTable } from "../components/ResultsTable";
import { SqlPanel } from "../components/SqlPanel";
import { StatusBanner } from "../components/StatusBanner";
import { WarningsList } from "../components/WarningsList";
import { getSessionId } from "../hooks/useSessionId";
import type { QueryResponse } from "../types/api";

/** Shown while the query is in flight. The sweep is indeterminate on purpose:
 * the backend reports no progress through generation, guardrails and execution,
 * so a filling bar would be inventing a number. Nothing here previews the
 * shape of the answer either -- a skeleton results table would promise rows to
 * a question that may be about to come back BLOCKED. */
function RunningPanel() {
  return (
    <div className="animate-rise overflow-hidden rounded-2xl border border-white/[0.09] bg-[#0f1728]/85">
      <div className="flex items-center gap-3 px-5 py-4 text-sm text-white/55">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/15 border-t-blue-400" />
        Generating and checking SQL…
      </div>
      <div className="relative h-[2px] overflow-hidden bg-white/[0.06]">
        <div className="animate-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-blue-400 to-transparent" />
      </div>
    </div>
  );
}

export function WorkspaceScreen() {
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const run = async (question: string, sqlOverride?: string) => {
    setLoading(true);
    setClientError(null);
    try {
      const result = await postQuery({
        question,
        session_id: getSessionId(),
        max_rows: 1000,
        ...(sqlOverride ? { sql_override: sqlOverride } : {}),
      });
      setResponse(result);
    } catch (e) {
      setResponse(null);
      setClientError(e instanceof ApiError ? e.message : "Unexpected client error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8 md:px-8">
      <QuestionInput onSubmit={(q) => run(q)} loading={loading} />

      {clientError && <ErrorPanel message={clientError} />}

      {loading && <RunningPanel />}

      {response && !loading && (
        /* The status chip is the heading of the response, not one card among
           several: it sits outside the panel stack, at the largest type on the
           page after the question itself, because on this project the state of
           a query matters more than its output.

           `response-stack` staggers the entrance of the direct children below
           (see index.css). The stack unmounts whenever a query is in flight, so
           each new response replays its entrance without needing a key. */
        <div className="response-stack space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <StatusBanner
              status={response.status}
              reason={response.status === "clarification" ? null : response.status_reason}
            />
            {response.execution_time_ms != null && (
              <span className="animate-fade shrink-0 pt-1.5 text-xs tabular-nums text-white/35 [animation-delay:200ms]">
                {response.execution_time_ms.toFixed(0)} ms
              </span>
            )}
          </div>

          <WarningsList warnings={response.warnings} />

          {response.status === "clarification" && response.clarification && (
            <ClarificationPanel clarification={response.clarification} onSelect={(opt) => run(opt)} />
          )}

          {response.status === "error" && <ErrorPanel message={response.error_message} />}

          {response.status === "blocked" && <GuardrailBanner guardrail={response.guardrail} />}

          {response.status === "success" && (
            <SqlPanel
              sql={response.sql}
              explanation={response.explanation}
              tablesUsed={response.tables_used}
              columnsUsed={response.columns_used}
              onRerun={(editedSql) => run(response.question, editedSql)}
              rerunning={loading}
            />
          )}

          <ResultsTable results={response.results} executed={response.status === "success"} />

          <ConfidenceCard confidence={response.confidence} />
        </div>
      )}
    </div>
  );
}
