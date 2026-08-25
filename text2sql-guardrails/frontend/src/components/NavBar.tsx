export type Screen = "workspace" | "history" | "schema" | "admin";

const TABS: { key: Screen; label: string }[] = [
  { key: "workspace", label: "Workspace" },
  { key: "history", label: "History" },
  { key: "schema", label: "Schema Explorer" },
  { key: "admin", label: "Admin" },
];

interface Props {
  active: Screen;
  onChange: (screen: Screen) => void;
}

export function NavBar({ active, onChange }: Props) {
  return (
    <header className="border-b border-white/10 px-6 py-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Text-to-SQL Guardrails</h1>
          <p className="text-xs text-white/40">college_erp</p>
        </div>
        <nav className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active === tab.key
                  ? "bg-blue-600 text-white"
                  : "text-white/50 hover:bg-white/5 hover:text-white/80"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
