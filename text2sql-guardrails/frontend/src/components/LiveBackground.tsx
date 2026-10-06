/**
 * The app background, rendered once above the auth gate so every screen
 * sits on the same surface. Deliberately static (styles in index.css,
 * `.app-bg`): a paper tone with two faint warm washes and grain. Nothing
 * animates, so it never competes with results or costs frames.
 */
export function LiveBackground() {
  return <div aria-hidden className="app-bg pointer-events-none fixed inset-0 z-0" />;
}
