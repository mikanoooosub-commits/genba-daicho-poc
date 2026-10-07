"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus } from "lucide-react";

import { addUnitsAction } from "@/lib/data/actions-buildings";
import { parseRoomNumbers } from "@/lib/validation/building";

// 物件に部屋を足す(「部屋を足す」)。同じ部屋番号は足さない(サーバー側で確かめる)。
export function AddUnitsForm({ buildingId }: { buildingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        <Plus className="icon" aria-hidden="true" />
        部屋を足す
      </button>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const list = parseRoomNumbers(rooms);
    startTransition(async () => {
      const result = await addUnitsAction({ buildingId, rooms: list });
      if (result.ok) {
        setRooms("");
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "var(--sp-2)", alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="field" style={{ minWidth: 220 }}>
        <label htmlFor="add-rooms" className="visually-hidden">
          足す部屋番号
        </label>
        <input
          id="add-rooms"
          className="input"
          value={rooms}
          onChange={(e) => setRooms(e.target.value)}
          placeholder="例: 401, 402"
          autoFocus
        />
        {error && (
          <p className="error-text" role="alert">
            <AlertTriangle className="icon" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "保存中…" : "足す"}
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
        やめる
      </button>
    </form>
  );
}
