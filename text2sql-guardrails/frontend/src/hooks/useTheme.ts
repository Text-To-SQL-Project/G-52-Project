import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "theme";

const current = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** Theme state. public/theme-init.js applies it before first paint; this keeps
 * React in sync, follows the OS until the user chooses, and syncs tabs. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(current);

  useEffect(() => {
    const os = window.matchMedia("(prefers-color-scheme: light)");
    const onOs = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem(KEY); } catch { /* blocked */ }
      if (!saved) apply(os.matches ? "light" : "dark", false);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && (e.newValue === "light" || e.newValue === "dark")) apply(e.newValue, false);
    };
    const onChange = () => setThemeState(current());
    os.addEventListener("change", onOs);
    window.addEventListener("storage", onStorage);
    window.addEventListener("themechange", onChange);
    return () => {
      os.removeEventListener("change", onOs);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("themechange", onChange);
    };
  }, []);

  return theme;
}

/** Switch theme; `remember` persists it as an explicit choice. Fires
 * "themechange" so canvas/WebGL code that can't read CSS live can repaint. */
export function apply(theme: Theme, remember = true) {
  document.documentElement.dataset.theme = theme;
  if (remember) {
    try { localStorage.setItem(KEY, theme); } catch { /* blocked */ }
  }
  window.dispatchEvent(new Event("themechange"));
}

/** Resolve a CSS custom property to a concrete colour (for three.js etc.). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
