import { useEffect, useRef, useState } from "react";
import { downloadBlob } from "../export/download";
import type { BoardRecord } from "../storage/db";
import { backupBoards, restoreBoards } from "./backup";
import { boardRepository } from "./BoardRepository";

interface Props {
  onOpen: (id: string) => void;
}

export function BoardList({ onOpen }: Props) {
  const [boards, setBoards] = useState<BoardRecord[] | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    if (
      !window.confirm(
        `Delete "${b.name}" and everything on it? This cannot be undone.`,
      )
    ) {
      return;
    }
    await boardRepository.delete(b.id);
    await refresh();
  };

  const backup = async () => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      downloadBlob(await backupBoards(), `inkboard-backup-${date}.inkboard`);
    } catch (err) {
      console.error(err);
      window.alert("Could not create the backup.");
    }
  };

  const restore = async (file: File) => {
    try {
      await restoreBoards(file);
      await refresh();
    } catch (err) {
      console.error(err);
      window.alert(
        `Could not restore "${file.name}". Is it an Inkboard backup?`,
      );
    }
  };

  return (
    <div className="board-list">
      <header className="board-list-header">
        <h1>My Boards</h1>
        <button type="button" className="btn btn-primary" onClick={create}>
          New board
        </button>
      </header>
      {boards === null
        ? <p className="muted">Loading…</p>
        : boards.length === 0
        ? (
          <div className="empty">
            <p>No boards yet.</p>
            <button type="button" className="btn btn-primary" onClick={create}>
              Create your first board
            </button>
          </div>
        )
        : (
          <ul className="board-items">
            {boards.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className="board-item"
                  onClick={() => onOpen(b.id)}
                >
                  <span className="board-name">{b.name}</span>
                  <span className="board-date">
                    Edited {formatDate(b.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`Delete ${b.name}`}
                  onClick={() => remove(b)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      <footer className="board-list-footer muted">
        Everything is stored in this browser.{" "}
        {used !== null && `Local storage used: ${formatBytes(used)}`}
        <div className="board-list-backup">
          {!!boards?.length && (
            <button type="button" className="btn btn-sm" onClick={backup}>
              Back up all boards
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => fileRef.current?.click()}
          >
            Restore from backup
          </button>
          {/* No `accept`: iOS greys out unknown extensions like .inkboard. */}
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void restore(f);
              e.target.value = "";
            }}
          />
        </div>
      </footer>
    </div>
  );
}

function formatDate(ts: number) {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString();
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
