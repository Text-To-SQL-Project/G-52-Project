/**
 * The app's living wallpaper. Rendered once, above the auth gate, so every
 * screen including Login sits on the same surface.
 *
 * Five stacked layers, all CSS, no canvas and no dependency:
 *
 *   1. base       deep neutral void (var(--bg-void)), preventing any white flash on load
 *   2. depth      a vertical gradient sinking the page toward the bottom
 *   3. grid       a fine technical lattice, drifting one tile per cycle so
 *                 the loop is seamless, radially masked to dissolve at edges
 *   4. blooms     three slow warm amber fields on long, mutually prime cycles, so
 *                 the composition never visibly repeats
 *   5. scan       one faint band easing down the page — the "alive" beat
 *   6. grain      static film grain, killing gradient banding on projectors
 *
 * Design constraints this layer has to respect:
 *
 * - Zero blue, zero purple across all background elements.
 * - Blooms use warm amber only (the single UI accent).
 * - Green is reserved strictly for SUCCESS/PASS status chips.
 * - Everything animates `transform` or nothing at all, keeping it GPU-composited.
 * - Content panels are opaque enough to read over any frame of this.
 * - The whole thing freezes under prefers-reduced-motion (see index.css) and
 *   still looks deliberate when static.
 */
export function LiveBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0" style={{ background: "var(--bg-void)" }} />
      <div className="bg-depth absolute inset-0" />
      <div className="bg-grid absolute -inset-32" />
      <div className="bg-bloom bg-bloom-a" />
      <div className="bg-bloom bg-bloom-b" />
      <div className="bg-bloom bg-bloom-c" />
      <div className="bg-scan absolute inset-x-0" />
      <div className="bg-grain absolute inset-0" />
    </div>
  );
}
