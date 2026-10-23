import { useEffect, useState, type FormEvent } from "react";
import { Check, KeyRound, Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "../kit";
import { ApiError, getAuthProviders, getUsers, setUserEmail } from "../../api/client";
import type { AdminUser } from "../../types/api";

const fieldCls = "h-8 min-w-0 flex-1 rounded-lg border border-input bg-background/60 px-2.5 font-mono text-xs text-foreground outline-none transition-[border-color,box-shadow] placeholder:italic placeholder:text-muted-foreground focus:border-[rgb(var(--brand-rgb)/0.5)] focus:shadow-[0_0_0_4px_rgb(var(--brand-rgb)/0.1)]";

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
      toast.success(value.trim() ? `Linked ${u.username}` : `Unlinked ${u.username}`);
      window.setTimeout(() => setState("idle"), 1600);
    } catch (x) {
      setState("idle");
      setError(x instanceof ApiError ? x.message.replace(/^Request failed \(\d+\): /, "") : "Could not save.");
    }
  };

  return (
    <tr className="border-t border-border transition-colors hover:bg-hover/60">
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
            className={fieldCls}
          />
          <button
            type="submit"
            disabled={!dirty || state === "saving"}
            className={`press inline-flex h-8 w-16 shrink-0 items-center justify-center gap-1 rounded-lg border font-mono text-[11px] transition-colors disabled:opacity-40 sm:w-20 ${
              state === "saved" ? "border-[rgb(var(--success-rgb)/0.4)] text-success" : "border-border text-soft hover:border-[rgb(var(--brand-rgb)/0.45)] hover:text-brand"
            }`}
          >
            {state === "saving" ? <Loader2 aria-hidden className="size-3 animate-spin" /> : state === "saved" ? <Check aria-hidden className="size-3" /> : !value.trim() && u.email ? <Unlink aria-hidden className="size-3" /> : <Link2 aria-hidden className="size-3" />}
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
    <Panel
      icon={KeyRound}
      title="Google sign-in"
      id="google-title"
      aria-labelledby="google-title"
      bodyClassName="p-0"
      meta={
        configured !== null && (
          <span className="inline-flex items-center gap-2 font-mono text-[11px] text-soft">
            <span aria-hidden className="live-dot" style={{ "--dot": configured ? "var(--success)" : "var(--muted-foreground)" } as React.CSSProperties} />
            {configured ? "Enabled on the sign-in page" : "Off: GOOGLE_CLIENT_ID not set"}
          </span>
        )
      }
    >
      <div className="space-y-5 p-5 sm:p-6">
        <p className="max-w-prose text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          A linked Google email signs in as that user, with their role and data access. Any other
          Google account gets a guest login that sees reference data only. Linking a guest's
          email to a user here moves it to that user and closes the guest account.
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
    </Panel>
  );
}
