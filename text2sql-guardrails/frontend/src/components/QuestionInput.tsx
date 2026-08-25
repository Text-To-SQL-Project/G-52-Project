import { useState } from "react";

interface Props {
  onSubmit: (question: string) => void;
  loading: boolean;
}

export function QuestionInput({ onSubmit, loading }: Props) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed && !loading) onSubmit(trimmed);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <label htmlFor="question" className="mb-2 block text-sm font-medium text-white/70">
        Ask a question about the database
      </label>
      <div className="flex gap-3">
        <textarea
          id="question"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. Which students have an attendance percentage below 75%?"
          rows={2}
          className="flex-1 resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={loading || !value.trim()}
          className="shrink-0 self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
        >
          {loading ? "Running…" : "Run"}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-white/30">Enter to run · Shift+Enter for a new line</p>
    </div>
  );
}
