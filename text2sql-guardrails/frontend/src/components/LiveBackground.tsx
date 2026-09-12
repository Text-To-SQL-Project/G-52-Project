/**
 * The app's living wallpaper. Rendered once, above the auth gate, so every
 * screen including Login sits on the same surface.
 *
 * Five stacked layers, all CSS, no canvas and no dependency:
 *
 *   1. base       flat navy, so there is never a flash of white on load
 *   2. depth      a vertical gradient that sinks the page towards the bottom
 *   3. grid       a fine technical lattice, drifting exactly one tile per
 *                 cycle so the loop is seamless, radially masked so it
 *                 dissolves before it reaches the edges of the viewport
 *   4. blooms     three slow colour fields on long, mutually prime cycles, so
 *                 the composition never visibly repeats
 *   5. scan       one faint band easing down the page, the "something is
 *                 alive here" beat
 *   6. grain      static film grain, which kills the banding that wide dark
 *                 gradients show on a projector
 *
 * Design constraints this layer has to respect:
 *
 * - Nothing here is green, and the blooms are held to indigo/violet/blue.
 *   Green means SUCCESS and PASS, and a wash of it behind a REFUSED chip would
 *   undercut the single most important thing this UI says.
 * - Everything animates `transform` or nothing at all. No `filter: blur()` on
 *   a moving element -- the blooms are soft because they are radial gradients
 *   with long tails, not because they are blurred, which keeps them free to
 *   composite on the GPU.
 * - Content panels are opaque enough to read over any frame of this. If a
 *   panel ever looks washed out, raise the panel's alpha rather than dimming
 *   the wallpaper.
 * - The whole thing freezes under prefers-reduced-motion (see index.css) and
 *   still looks deliberate when static.
 */
export function LiveBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[#0b1120]" />
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
