import { useToolStore } from "../store/toolStore";

export function ImportProgressToast() {
  const p = useToolStore((s) => s.importProgress);
  if (!p) return null;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div
      className={"toast" + (p.error ? " toast-error" : "")}
      role="status"
      aria-live="polite"
    >
      <div className="toast-title">
        {p.error
          ? p.error
          : p.done < p.total
            ? "Importing PDF"
            : "PDF imported"}
      </div>
      {!p.error && (
        <>
          <div className="toast-meta" title={p.fileName}>
            {p.fileName} · {p.done} / {p.total} pages
          </div>
          <div className="progress" aria-hidden="true">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
