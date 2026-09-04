import { useToolStore } from "../store/toolStore";

export function StatusChip() {
  const status = useToolStore((s) => s.saveStatus);
  const label =
    status === "saving"
      ? "Saving…"
      : status === "error"
        ? "Save failed"
        : "Saved locally";
  return (
    <span
      className={"status-chip status-" + status}
      role="status"
      aria-live="polite"
    >
      <span className="status-dot" />
      {label}
    </span>
  );
}
