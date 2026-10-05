import { useEffect, useRef, useState } from "react";

// Minimal typing for the slice of Google Identity Services used here.
type Gis = {
  accounts: {
    id: {
      initialize(opts: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }): void;
      renderButton(el: HTMLElement, opts: Record<string, string | number>): void;
    };
  };
};
declare global {
  interface Window { google?: Gis }
}

let gisScript: Promise<void> | null = null;
function loadGis(): Promise<void> {
  gisScript ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisScript = null; // allow a retry on next mount
      reject(new Error("Could not load Google sign-in."));
    };
    document.head.appendChild(s);
  });
  return gisScript;
}

/** Google's own rendered button (their branding rules require it). Sends the
 * ID token to `onCredential`; the server verifies it and links by email. */
export function GoogleSignIn({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => void }) {
  const slot = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const callback = useRef(onCredential);
  useEffect(() => { callback.current = onCredential; }, [onCredential]);

  useEffect(() => {
    let cancelled = false;
    loadGis()
      .then(() => {
        if (cancelled || !slot.current || !window.google) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => callback.current(r.credential) });
        window.google.accounts.id.renderButton(slot.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          shape: "rectangular",
          text: "signin_with",
          logo_alignment: "left",
          width: slot.current.clientWidth || 320,
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; };
  }, [clientId]);

  if (failed) {
    return (
      <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
        Google sign-in is unavailable right now. Use your username and password.
      </p>
    );
  }
  // Fixed height reserves the button's space so the form doesn't jump when it renders.
  return <div ref={slot} className="flex h-[44px] w-full justify-center" aria-label="Sign in with Google" />;
}
