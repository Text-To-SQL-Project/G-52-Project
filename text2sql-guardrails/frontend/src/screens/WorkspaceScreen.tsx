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
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
      <QuestionInput onSubmit={(q) => run(q)} loading={loading} />

      {clientError && <ErrorPanel message={clientError} />}

      {loading && (
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
          Generating and checking SQL…
        </div>
      )}

      {response && !loading && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <StatusBanner status={response.status} />
            {response.execution_time_ms != null && (
              <span className="text-xs text-white/30">{response.execution_time_ms.toFixed(0)} ms</span>
            )}
          </div>

          <WarningsList warnings={response.warnings} />

          {response.status === "clarification" && response.clarification && (
            <ClarificationPanel clarification={response.clarification} onSelect={(opt) => run(opt)} />
          )}

          {response.status === "error" && <ErrorPanel message={response.error_message} />}

          {response.status === "blocked" && <GuardrailBanner guardrail={response.guardrail} />}

          <SqlPanel
            sql={response.sql}
            explanation={response.explanation}
            tablesUsed={response.tables_used}
            columnsUsed={response.columns_used}
            onRerun={(editedSql) => run(response.question, editedSql)}
            rerunning={loading}
          />

          {response.status === "success" && response.results && (
            <ResultsTable results={response.results} />
          )}

          {response.status === "success" && response.confidence && (
            <ConfidenceCard confidence={response.confidence} />
          )}
        </div>
      )}
    </div>
  );
}
