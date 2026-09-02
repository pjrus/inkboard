import { useEffect, useState } from "react";
import type { BoardRecord } from "../storage/db";
import { boardRepository } from "./BoardRepository";

interface Props {
  onOpen: (id: string) => void;
}

export function BoardList({ onOpen }: Props) {
  const [boards, setBoards] = useState<BoardRecord[] | null>(null);
  const [used, setUsed] = useState<number | null>(null);

  const refresh = async () => {
    setBoards(await boardRepository.list());
    setUsed(await boardRepository.storageUsed());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    const b = await boardRepository.create("Untitled board");
    onOpen(b.id);
  };

  const remove = async (b: BoardRecord) => {
    if (!window.confirm(`Delete "${b.name}" and everything on it? This cannot be undone.`)) return;
    await boardRepository.delete(b.id);
    await refresh();
  };

  return (
    <div className="board-list">
      <header className="board-list-header">
        <h1>My Boards</h1>
        <button type="button" className="btn btn-primary" onClick={create}>
          New board
        </button>
      </header>
      {boards === null ? (
        <p className="muted">Loading…</p>
      ) : boards.length === 0 ? (
        <div className="empty">
          <p>No boards yet.</p>
          <button type="button" className="btn btn-primary" onClick={create}>
            Create your first board
          </button>
        </div>
      ) : (
        <ul className="board-items">
          {boards.map((b) => (
            <li key={b.id}>
              <button type="button" className="board-item" onClick={() => onOpen(b.id)}>
                <span className="board-name">{b.name}</span>
                <span className="board-date">Edited {formatDate(b.updatedAt)}</span>
              </button>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${b.name}`} onClick={() => remove(b)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <footer className="board-list-footer muted">
        Everything is stored in this browser. {used !== null && `Local storage used: ${formatBytes(used)}`}
      </footer>
    </div>
  );
}

function formatDate(ts: number) {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
