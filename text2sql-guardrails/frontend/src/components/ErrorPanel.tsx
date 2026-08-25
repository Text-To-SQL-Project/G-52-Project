export function ErrorPanel({ message }: { message?: string | null }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
      <h3 className="mb-1.5 text-sm font-medium text-red-400">Something went wrong</h3>
      <p className="text-sm text-red-300/90">{message ?? "No error detail was returned."}</p>
    </div>
  );
}
