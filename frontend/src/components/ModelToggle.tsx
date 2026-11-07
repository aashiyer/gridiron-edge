import { useModelHints } from "../lib/ModelHintsContext";

export function ModelToggle() {
  const { show, setShow } = useModelHints();
  return (
    <button
      onClick={() => setShow(!show)}
      role="switch"
      aria-checked={show}
      title={show ? "Hide the model's suggestions" : "Show the model's suggestions"}
      className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)]/50 transition-colors"
    >
      <span>Model</span>
      <span className={`relative inline-block h-4 w-7 rounded-full transition-colors ${show ? "bg-[var(--accent)]" : "bg-[var(--surface-hover)] border border-[var(--border)]"}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${show ? "left-3.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}
