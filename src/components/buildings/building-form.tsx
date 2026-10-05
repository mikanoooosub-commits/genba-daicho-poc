"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import {
  createBuildingAction,
  findSimilarBuildingsAction,
  updateBuildingAction,
} from "@/lib/data/actions-buildings";
import type { SimilarBuilding } from "@/lib/data/queries-buildings";
import { BUILDING_KIND_ORDER, type BuildingKind, type Client } from "@/lib/types";
import { BUILDING_KINDS, parseRoomNumbers } from "@/lib/validation/building";
import { z } from "zod";

// 物件の登録・編集フォーム(WO-011 段階1)。
// - 入居者名・発注元の担当者名の入力欄は作らない(poc-app/CLAUDE.md §2)。
// - 位置(緯度・経度)の入力欄は作らない(D80)。
// - 登録のときは、物件名を入れると「名前が似ている物件」を先に出す(同じ建物の二重登録を防ぐ。一意にはしない)。

type Props =
  | { mode: "create"; clients: Client[] }
  | {
      mode: "edit";
      clients: Client[];
      buildingId: string;
      initial: {
        name: string;
        kind: BuildingKind;
        address: string;
        defaultClientId: string;
        memo: string;
      };
    };

export function BuildingForm(props: Props) {
  const initial = props.mode === "edit" ? props.initial : null;
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<BuildingKind>(initial?.kind ?? "集合住宅");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [defaultClientId, setDefaultClientId] = useState(initial?.defaultClientId ?? "");
  const [rooms, setRooms] = useState("");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [similar, setSimilar] = useState<SimilarBuilding[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 登録のときだけ、物件名の入力が止まって 400ms 後に似た名前を探す
  useEffect(() => {
    if (props.mode !== "create") return;
    if (timer.current) clearTimeout(timer.current);
    if (name.trim().length < 2) {
      setSimilar([]);
      return;
    }
    timer.current = setTimeout(() => {
      findSimilarBuildingsAction(name.trim()).then(setSimilar);
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [name, props.mode]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const common = {
      name,
      kind,
      address: address || undefined,
      defaultClientId: defaultClientId || null,
      memo: memo || undefined,
    };
    startTransition(async () => {
      const result =
        props.mode === "edit"
          ? await updateBuildingAction({ id: props.buildingId, ...common })
          : await createBuildingAction({ ...common, rooms: parseRoomNumbers(rooms) });
      // 成功すると Server Action が redirect() するので、ここに戻るのは失敗のときだけ
      if (result && !result.ok) setError(result.error);
    });
  }

  const roomPreview = parseRoomNumbers(rooms);

  return (
    <form onSubmit={handleSubmit} className="card card-pad" style={{ display: "grid", gap: "var(--sp-4)", maxWidth: 640 }}>
      <div className="field">
        <label htmlFor="b-name">
          物件名<span className="req">必須</span>
        </label>
        <input
          id="b-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: さくらマンション、戸建て(大山町2丁目)"
          aria-describedby="b-name-hint"
          required
        />
        <p id="b-name-hint" className="hint">
          戸建ては、お名前ではなく町名などで書きます(個人が分かる情報は預かりません)。
        </p>
        {similar.length > 0 && (
          <div className="notice notice-warn" role="status">
            <AlertTriangle className="icon" aria-hidden="true" />
            <div>
              <strong>名前が似ている物件があります</strong>
              同じ建物なら、新しく登録せず、その物件に部屋を足します。
              <ul className="warn-list">
                {similar.map((b) => (
                  <li key={b.id}>
                    <Link href={`/buildings/${b.id}`}>{b.name}</Link>
                    {b.address ? `(${b.address})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="b-kind">種類</label>
        <select id="b-kind" className="select" value={kind} onChange={(e) => {
            const parsed = z.enum(BUILDING_KINDS).safeParse(e.target.value);
            if (parsed.success) setKind(parsed.data);
          }}>
          {BUILDING_KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="b-address">
          住所<span className="opt">任意</span>
        </label>
        <input
          id="b-address"
          className="input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="例: 東京都板橋区大山町1-2-3(番地まで。部屋番号は入れません)"
        />
      </div>

      <div className="field">
        <label htmlFor="b-client">
          ふだんの発注元<span className="opt">任意</span>
        </label>
        <select id="b-client" className="select" value={defaultClientId} onChange={(e) => setDefaultClientId(e.target.value)}>
          <option value="">決めていない</option>
          {props.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="hint">案件を登録するとき、発注元の初期値になります。</p>
      </div>

      {props.mode === "create" && (
        <div className="field">
          <label htmlFor="b-rooms">
            部屋番号<span className="opt">任意</span>
          </label>
          <input
            id="b-rooms"
            className="input"
            value={rooms}
            onChange={(e) => setRooms(e.target.value)}
            placeholder="例: 203, 305(複数は「,」か空白で区切る)"
          />
          <p className="hint">
            {roomPreview.length > 0
              ? `${roomPreview.length}部屋を登録します: ${roomPreview.join("、")}`
              : "戸建てや店舗など、部屋の区別が無いときは空のままにします。あとから足せます。"}
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor="b-memo">
          メモ<span className="opt">任意</span>
        </label>
        <textarea
          id="b-memo"
          className="textarea"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="例: 鍵はエントランスの管理ボックス。駐車は向かいのコインパーキング"
        />
        <p className="hint">入居者のお名前や連絡先は書かないでください(預かる情報を減らすため)。</p>
      </div>

      {error && (
        <p className="error-text" role="alert">
          <AlertTriangle className="icon" aria-hidden="true" />
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "保存中…" : props.mode === "edit" ? "保存する" : "登録する"}
        </button>
        <Link
          className="btn btn-secondary"
          href={props.mode === "edit" ? `/buildings/${props.buildingId}` : "/buildings"}
        >
          やめる
        </Link>
      </div>
    </form>
  );
}
