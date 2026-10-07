/**
 * The app background, rendered once above the auth gate so every screen
 * sits on the same surface: a faint dot grid with two washes, plus a copy
 * of the grid lit only around the pointer (index.css `.app-bg`, driven by
 * motion.ts). Only a mask moves; nothing re-lays out.
 */
export function LiveBackground() {
  return <div aria-hidden className="app-bg pointer-events-none fixed inset-0 z-0" />;
}
