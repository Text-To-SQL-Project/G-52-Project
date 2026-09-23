/**
 * Loading placeholders — the app's one signature live animation, shared by all
 * five screens so a pending state looks the same wherever it appears.
 */

export function SkeletonLine({ w = "w-full", h = "h-4" }: { w?: string; h?: string }) {
  return <span className={`skeleton block ${h} ${w}`} />;
}

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

export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div style={{ borderBottom: "1px solid var(--border-subtle)", padding: "16px 0" }}>
      <SkeletonLine w="w-1/3" h="h-3" />
      <div className="mt-4">
        <SkeletonText lines={lines} />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 5, lines = 2 }: { count?: number; lines?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  );
}

export function LoadingStatus({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}
