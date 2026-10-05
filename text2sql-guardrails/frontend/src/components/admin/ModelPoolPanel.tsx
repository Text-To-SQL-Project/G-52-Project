import { useEffect, useState, type FormEvent } from "react";
import { addToPool, ApiError, checkPoolHealth, getPool, removeFromPool } from "../../api/client";
import type { PoolDeployment, PoolHealth, PoolStatus } from "../../types/api";

// Placeholder model ids, so admins see the expected shape per provider.
const MODEL_HINT: Record<string, string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-small-latest",
  deepseek: "deepseek-chat",
  xai: "grok-3-mini",
  openrouter: "meta-llama/llama-3.3-70b-instruct",
};

const label = "font-mono text-[10px] uppercase tracking-wider";
const field: React.CSSProperties = {
  background: "var(--bg-void)",
  border: "1px solid var(--border-hairline)",
  borderRadius: "2px",
  color: "var(--text-primary)",
};
const fmtMs = (ms?: number | null) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

function StatusPill({ status }: { status: PoolStatus }) {
  const [text, color] = !status.configured
    ? ["Not configured", "var(--text-muted)"]
    : !status.reachable
      ? ["Pool service unreachable", "var(--danger)"]
      : status.app_provider === "litellm"
        ? ["Serving app queries", "var(--success)"]
        : [`Idle — app uses ${status.app_provider}`, "var(--warning)"];
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
      <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` }} />
      {text}
    </span>
  );
}

function Row({ d, health, onRemove }: { d: PoolDeployment; health?: string | true; onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirming]);

  return (
    <tr className="animate-fade" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <span
            aria-label={health === undefined ? "Not checked" : health === true ? "Healthy" : "Failing"}
            title={typeof health === "string" ? health : undefined}
            className="h-[7px] w-[7px] shrink-0 rounded-full"
            style={{
              background: health === undefined ? "transparent" : health === true ? "var(--success)" : "var(--danger)",
              boxShadow: health === undefined ? "inset 0 0 0 1px var(--text-muted)" : undefined,
            }}
          />
          <span className="font-mono text-xs" style={{ color: "var(--text-primary)" }}>{d.provider}</span>
        </div>
        {typeof health === "string" && (
          <p className="mt-1 max-w-xs truncate text-[11px]" style={{ color: "var(--danger)" }} title={health}>{health}</p>
        )}
      </td>
      <td className="py-3 pr-4 font-mono text-xs" style={{ color: "var(--text-secondary)" }}>
        {d.model}
        {d.label && <span className="ml-2 font-sans" style={{ color: "var(--text-muted)" }}>{d.label}</span>}
      </td>
      <td className="py-3 pr-4 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
        {d.key_hint ? `••••${d.key_hint}` : "••••"}
      </td>
      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums" style={{ color: "var(--text-primary)" }}>
        {fmtMs(d.avg_latency_ms)}
      </td>
      <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
        {d.requests}
      </td>
      <td className="py-3 text-right">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!confirming) return setConfirming(true);
            setBusy(true);
            try { await onRemove(); } finally { setBusy(false); setConfirming(false); }
          }}
          className="px-2.5 py-1 font-mono text-[11px] transition-colors"
          style={{
            borderRadius: "2px",
            border: `1px solid ${confirming ? "var(--danger)" : "var(--border-hairline)"}`,
            color: confirming ? "var(--danger)" : "var(--text-secondary)",
            background: confirming ? "color-mix(in srgb, var(--danger) 8%, transparent)" : "transparent",
          }}
        >
          {busy ? "Removing…" : confirming ? "Confirm remove" : "Remove"}
        </button>
      </td>
    </tr>
  );
}

export function ModelPoolPanel() {
  const [status, setStatus] = useState<PoolStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<PoolHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState("groq");

  useEffect(() => {
    getPool().then(setStatus).catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load the key pool."));
  }, []);

  const healthOf = (id: string): string | true | undefined =>
    !health ? undefined : health.healthy.includes(id) ? true : health.unhealthy.find((u) => u.id === id)?.error;

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setSaving(true);
    setError(null);
    try {
      setStatus(await addToPool({
        provider,
        model: String(f.get("model")).trim(),
        api_key: String(f.get("api_key")).trim(),
        api_base: String(f.get("api_base") || "").trim() || undefined,
        label: String(f.get("label") || "").trim(),
      }));
      setHealth(null);
      form.reset();
    } catch (x) {
      setError(x instanceof ApiError ? x.message : "Could not add the key.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="animate-rise" style={{ border: "1px solid var(--border-subtle)", borderRadius: "2px" }} aria-labelledby="pool-title">
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--accent)" }}>hub</span>
          <h3 id="pool-title" className="font-mono text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            AI key pool
          </h3>
        </div>
        {status && <StatusPill status={status} />}
      </header>

      <div className="space-y-6 p-6">
        <p className="max-w-prose text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Keys from any provider. Each question goes to the fastest healthy key; a failing or
          rate-limited key is skipped for 30 seconds. Keys are stored encrypted by the pool service
          and never shown again after saving.
        </p>

        {error && (
          <p role="alert" className="px-3 py-2 text-xs" style={{ border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)", color: "var(--danger)", borderRadius: "2px" }}>
            {error}
          </p>
        )}

        {status && !status.configured && (
          <div className="space-y-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <p>The pool service isn't set up. From <code className="font-mono">text2sql-guardrails/</code>:</p>
            <pre className="sql-editor-card overflow-x-auto px-3 py-2 font-mono text-[11px]">docker compose up -d litellm</pre>
            <p style={{ color: "var(--text-muted)" }}>and set LITELLM_URL, LITELLM_MASTER_KEY and LITELLM_SALT_KEY in .env (see .env.example).</p>
          </div>
        )}

        {status?.reachable && (
          <>
            {status.deployments.length === 0 ? (
              <p className="py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                No keys yet. Add one below and app queries switch to the pool automatically.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead>
                    <tr className={label} style={{ color: "var(--text-muted)" }}>
                      <th className="pb-2 pr-4 font-normal">Provider</th>
                      <th className="pb-2 pr-4 font-normal">Model</th>
                      <th className="pb-2 pr-4 font-normal">Key</th>
                      <th className="pb-2 pr-4 text-right font-normal">Avg latency</th>
                      <th className="pb-2 pr-4 text-right font-normal">Requests</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {status.deployments.map((d) => (
                      <Row key={d.id} d={d} health={healthOf(d.id)} onRemove={async () => setStatus(await removeFromPool(d.id))} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={checking || status.deployments.length === 0}
                onClick={async () => {
                  setChecking(true);
                  setError(null);
                  try { setHealth(await checkPoolHealth()); }
                  catch (x) { setError(x instanceof ApiError ? x.message : "Health check failed."); }
                  finally { setChecking(false); }
                }}
                className="px-3 py-1.5 font-mono text-[11px] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
                style={{ border: "1px solid var(--border-hairline)", borderRadius: "2px", color: "var(--text-secondary)" }}
              >
                {checking ? "Checking every key…" : "Check health"}
              </button>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Sends one tiny request through each key.</span>
            </div>

            <form onSubmit={add} className="grid gap-3 pt-5 sm:grid-cols-12" style={{ borderTop: "1px solid var(--border-subtle)" }}>
              <p className={`${label} sm:col-span-12`} style={{ color: "var(--text-muted)" }}>Add a key</p>
              <label className="flex flex-col gap-1 sm:col-span-3">
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Provider</span>
                <select value={provider} onChange={(e) => setProvider(e.target.value)} className="px-2.5 py-2 font-mono text-xs" style={field}>
                  {status.providers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 sm:col-span-4">
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Model</span>
                <input name="model" required maxLength={200} placeholder={MODEL_HINT[provider] ?? "model-id"} className="px-2.5 py-2 font-mono text-xs" style={field} />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-5">
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>API key</span>
                <input name="api_key" type="password" required minLength={8} maxLength={500} autoComplete="off" spellCheck={false} className="px-2.5 py-2 font-mono text-xs" style={field} />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-4">
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Label <span style={{ color: "var(--text-muted)" }}>(optional)</span></span>
                <input name="label" maxLength={80} placeholder="e.g. Team Groq key" className="px-2.5 py-2 text-xs" style={field} />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-5">
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  API base <span style={{ color: "var(--text-muted)" }}>(only for self-hosted / OpenAI-compatible)</span>
                </span>
                <input name="api_base" type="url" maxLength={500} placeholder="https://…" className="px-2.5 py-2 font-mono text-xs" style={field} />
              </label>
              <div className="flex items-end sm:col-span-3">
                <button type="submit" disabled={saving} className="glow-button w-full px-4 py-2 font-sans text-xs font-semibold disabled:opacity-50" style={{ borderRadius: "2px" }}>
                  {saving ? "Adding…" : "Add key"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
