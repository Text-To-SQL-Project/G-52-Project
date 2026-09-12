/**
 * Loading placeholders -- the app's one signature live animation, shared by all
 * five screens so a pending state looks the same wherever it appears.
 *
 * Each placeholder mirrors the shape of the content it is standing in for,
 * which is the point: the old static "Loading…" string told you nothing about
 * what was coming or whether anything was still happening. On a demo where a
 * query round-trip is visibly slow, "the system is working" has to be legible
 * from across a room.
 *
 * Two things these deliberately do NOT do. They never imply a proportion
 * complete, because no endpoint here reports progress. And on the Workspace
 * screen nothing previews the shape of an answer, because a skeleton results
 * table would promise rows to a question that may be about to come back
 * BLOCKED -- see WorkspaceScreen's RunningPanel.
 *
 * The shimmer itself lives in index.css's `.skeleton`. Size these with
 * ordinary utilities; do not pass a `bg-*` class.
 */

/** A single placeholder bar. `w` is a Tailwind width class so callers can vary
 * line lengths and avoid the tell-tale look of identical stacked bars. */
export function SkeletonLine({ w = "w-full", h = "h-4" }: { w?: string; h?: string }) {
  return <span className={`skeleton block rounded-md ${h} ${w}`} />;
}

/** Placeholder for a block of prose or a list row's text. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  const widths = ["w-full", "w-11/12", "w-4/5", "w-3/5", "w-2/3"];
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} w={widths[i % widths.length]} h="h-3.5" />
      ))}
    </div>
  );
}

/** Placeholder card matching the panel surface used across the app. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#0f1728]/70 p-5">
      <SkeletonLine w="w-1/3" h="h-3" />
      <div className="mt-4">
        <SkeletonText lines={lines} />
      </div>
    </div>
  );
}

/** Stack of placeholder cards for a list-shaped screen (History, Schema). */
export function SkeletonList({ count = 5, lines = 2 }: { count?: number; lines?: number }) {
  return (
    <div className="space-y-2.5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}

/**
 * Announces a pending state to assistive technology. The placeholders above are
 * decorative and hidden from the accessibility tree, so without this a screen
 * reader would hear nothing at all where it used to hear "Loading…".
 */
export function LoadingStatus({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}
