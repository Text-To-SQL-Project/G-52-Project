import { useEffect, useState, type FormEvent } from "react";
import { ApiError, getAuthProviders, getUsers, setUserEmail } from "../../api/client";
import type { AdminUser } from "../../types/api";

const field: React.CSSProperties = {
  background: "var(--bg-void)",
  border: "1px solid var(--border-hairline)",
  borderRadius: "8px",
  color: "var(--text-primary)",
};

function UserRow({ u, onSaved }: { u: AdminUser; onSaved: (users: AdminUser[]) => void }) {
  const [value, setValue] = useState(u.email ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty = value.trim().toLowerCase() !== (u.email ?? "");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setState("saving");
    setError(null);
    try {
      const users = await setUserEmail(u.user_id, value.trim() || null);
      // Show what was stored (trimmed, lowercased), not what was typed.
      setValue(users.find((x) => x.user_id === u.user_id)?.email ?? "");
      onSaved(users);
      setState("saved");
      window.setTimeout(() => setState("idle"), 1600);
    } catch (x) {
      setState("idle");
      setError(x instanceof ApiError ? x.message.replace(/^Request failed \(\d+\): /, "") : "Could not save.");
    }
  };

  return (
    <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <td className="py-3 pr-4">
        <span className="font-mono text-xs" style={{ color: u.is_active ? "var(--text-primary)" : "var(--text-muted)" }}>
          {u.username}
        </span>
        {!u.is_active && <span className="ml-2 text-[11px]" style={{ color: "var(--text-muted)" }}>inactive</span>}
      </td>
      <td className="hidden py-3 pr-4 font-mono text-[11px] uppercase tracking-wider sm:table-cell" style={{ color: "var(--text-muted)" }}>{u.role}</td>
      <td className="py-3">
        <form onSubmit={save} className="flex items-center gap-2">
          <input
            type="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="not linked"
            aria-label={`Google email for ${u.username}`}
            maxLength={254}
            className="min-w-0 flex-1 px-2.5 py-1.5 font-mono text-xs placeholder:italic placeholder:text-[var(--text-ghost)]"
            style={field}
          />
          <button
            type="submit"
            disabled={!dirty || state === "saving"}
            className="w-16 shrink-0 px-2 py-1.5 font-mono text-[11px] sm:w-20 sm:px-2.5 transition-colors disabled:opacity-40"
            style={{
              borderRadius: "8px",
              border: "1px solid var(--border-hairline)",
              color: state === "saved" ? "var(--success)" : "var(--text-secondary)",
            }}
          >
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : !value.trim() && u.email ? "Unlink" : "Link"}
          </button>
        </form>
        {error && <p role="alert" className="mt-1 text-[11px]" style={{ color: "var(--danger)" }}>{error}</p>}
      </td>
    </tr>
  );
}

/** Links Google accounts to existing users by email. Sign-in never creates
 * accounts, because role and student/faculty links drive row-level security. */
export function GoogleLinkPanel() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getUsers().then(setUsers).catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load users."));
    getAuthProviders().then((p) => setConfigured(!!p.google_client_id)).catch(() => setConfigured(false));
  }, []);

  return (
    <section className="animate-rise" style={{ border: "1px solid var(--border-subtle)", borderRadius: "8px" }} aria-labelledby="google-title">
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px]" style={{ color: "var(--accent)" }}>key</span>
          <h3 id="google-title" className="font-mono text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            Google sign-in
          </h3>
        </div>
        {configured !== null && (
          <span className="inline-flex items-center gap-2 font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
            <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: configured ? "var(--success)" : "var(--text-muted)" }} />
            {configured ? "Enabled on the sign-in page" : "Off: GOOGLE_CLIENT_ID not set"}
          </span>
        )}
      </header>

      <div className="space-y-5 p-6">
        <p className="max-w-prose text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          A Google account can sign in only as the user whose email matches here. Accounts are
          never created from Google, so each user keeps the role and data access you assigned.
        </p>
        {error && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{error}</p>}
        {users && (
          <table className="w-full table-fixed text-left">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                <th className="w-1/4 pb-2 pr-3 font-normal sm:pr-4">User</th>
                <th className="hidden w-24 pb-2 pr-4 font-normal sm:table-cell">Role</th>
                <th className="pb-2 font-normal">Google email</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => <UserRow key={u.user_id} u={u} onSaved={setUsers} />)}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
