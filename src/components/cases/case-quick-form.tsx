"use client";

import { useMemo, useState, useTransition } from "react";

import { createCaseAction } from "@/lib/data/actions-cases";
import { BUILDING_KIND_ORDER, WORK_KIND_ORDER, type BuildingKind, type Client, type WorkKind } from "@/lib/types";
import type { CaseBuildingOption, CaseUnitOption } from "@/lib/validation/case";

// 案件の登録(現場でスマホ1分)。見本 docs/design-samples/quick-entry.html の A の形。
// 選ぶだけで済む形にし、文字を打つのは物件の検索・依頼の内容(任意)・新しい番号(任意)だけにした。
// 必須は物件と発注元だけ。発注元は物件のふだんの発注元が初めから入る。受付日は今日(DB の既定値)。
// 入力の回数の数え方: タップ1回=1、1行の文字入力1回=1、「登録」ボタンも1回。
// 初期値のまま変えない項目(発注元・種類)は数えない。最短は 物件 → 部屋 → 登録 の3回。

const SEARCH_RESULT_LIMIT = 6;

type Props = {
  buildings: CaseBuildingOption[];
  units: CaseUnitOption[];
  clients: Client[];
  recentBuildingIds: string[];
  /** 物件の画面の「この部屋で案件を登録」から来たときの初期値 */
  initialBuildingId?: string;
  initialUnitId?: string;
};

export function CaseQuickForm({ buildings, units, clients, recentBuildingIds, initialBuildingId, initialUnitId }: Props) {
  const [search, setSearch] = useState("");
  const [buildingId, setBuildingId] = useState<string | null>(initialBuildingId ?? null);
  const [newBuilding, setNewBuilding] = useState(false);
  const [newBuildingName, setNewBuildingName] = useState("");
  const [newBuildingKind, setNewBuildingKind] = useState<BuildingKind>("集合住宅");
  const [unitId, setUnitId] = useState<string | null>(initialUnitId ?? null);
  const [addingRoom, setAddingRoom] = useState(false);
  const [newRoomNo, setNewRoomNo] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [changingClient, setChangingClient] = useState(false);
  const [workKind, setWorkKind] = useState<WorkKind>("原状回復");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const buildingById = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const selected = buildingId ? (buildingById.get(buildingId) ?? null) : null;

  // 候補: 検索語があればその結果、なければ最近の物件
  const candidates = useMemo(() => {
    const q = search.trim();
    if (q) {
      return buildings.filter((b) => b.name.includes(q)).slice(0, SEARCH_RESULT_LIMIT);
    }
    const recent = recentBuildingIds
      .map((id) => buildingById.get(id))
      .filter((b): b is CaseBuildingOption => b !== undefined);
    return selected && !recent.some((b) => b.id === selected.id) ? [selected, ...recent] : recent;
  }, [search, buildings, recentBuildingIds, buildingById, selected]);

  const buildingUnits = useMemo(
    () => (buildingId ? units.filter((u) => u.building_id === buildingId && u.room_no !== null) : []),
    [units, buildingId]
  );

  // 発注元: 選んだものがあればそれ。なければ物件のふだんの発注元
  const defaultClientId = selected?.default_client_id ?? null;
  const effectiveClientId = clientId ?? defaultClientId;
  const effectiveClient = effectiveClientId ? (clientById.get(effectiveClientId) ?? null) : null;
  const showClientSelect = changingClient || (!effectiveClient && (selected !== null || newBuilding));

  function pickBuilding(id: string) {
    setBuildingId(id);
    setNewBuilding(false);
    setUnitId(null);
    setAddingRoom(false);
    setNewRoomNo("");
    setClientId(null);
    setChangingClient(false);
  }

  function pickNewBuilding() {
    setBuildingId(null);
    setNewBuilding(true);
    setUnitId(null);
    setAddingRoom(true);
    setClientId(null);
    setChangingClient(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!selected && !(newBuilding && newBuildingName.trim())) {
      setError("物件を選ぶか、新しい物件の名前を入れてください");
      return;
    }
    if (!effectiveClientId) {
      setError("発注元を選んでください");
      return;
    }
    startTransition(async () => {
      const result = await createCaseAction({
        ...(selected ? { buildingId: selected.id } : { newBuildingName: newBuildingName.trim(), newBuildingKind }),
        ...(unitId && !addingRoom ? { unitId } : {}),
        ...(addingRoom && newRoomNo.trim() ? { newRoomNo: newRoomNo.trim() } : {}),
        clientId: effectiveClientId,
        workKind,
        requestSummary: summary.trim() || undefined,
      });
      // 成功すると Server Action が案件の画面へ redirect() するので、ここに戻るのは失敗のときだけ
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form className="quick" onSubmit={handleSubmit} noValidate>
      <div className="q">
        <div className="q-label">
          <span className="no">1</span>物件<span className="req">必須</span>
        </div>
        <input
          className="input"
          type="search"
          placeholder="物件名で探す"
          aria-label="物件名で探す"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="picks" role="group" aria-label={search.trim() ? "探した物件" : "最近の物件"}>
          {candidates.map((b) => (
            <button key={b.id} type="button" className="pick" aria-pressed={buildingId === b.id} onClick={() => pickBuilding(b.id)}>
              {b.name}
              <small>
                {b.kind}
                {b.default_client_id ? `・${clientById.get(b.default_client_id)?.name ?? ""}` : ""}
              </small>
            </button>
          ))}
          <button type="button" className="pick add" aria-pressed={newBuilding} onClick={pickNewBuilding}>
            ＋ 新しい物件
          </button>
        </div>
        {search.trim() && candidates.length === 0 && <p className="hint">その名前の物件はありません。「＋ 新しい物件」で登録できます。</p>}
        {newBuilding && (
          <div className="q" style={{ marginTop: "var(--sp-2)" }}>
            <label htmlFor="new-bname" className="visually-hidden">
              新しい物件の名前
            </label>
            <input
              id="new-bname"
              className="input"
              placeholder="物件名(戸建ては「戸建て(大山町2丁目)」のように)"
              value={newBuildingName}
              maxLength={200}
              onChange={(e) => setNewBuildingName(e.target.value)}
            />
            <div className="seg" role="group" aria-label="物件の種類">
              {BUILDING_KIND_ORDER.map((k) => (
                <button key={k} type="button" className="pick" aria-pressed={newBuildingKind === k} onClick={() => setNewBuildingKind(k)}>
                  {k}
                </button>
              ))}
            </div>
            <p className="hint">人の名前は入れません。住所は、あとで物件の画面から足せます。</p>
          </div>
        )}
      </div>

      <div className="q">
        <div className="q-label">
          <span className="no">2</span>部屋<span className="opt">任意</span>
        </div>
        {(selected || newBuilding) && (
          <div className="picks three" role="group" aria-label="部屋">
            {buildingUnits.map((u) => (
              <button
                key={u.id}
                type="button"
                className="pick center"
                aria-pressed={unitId === u.id && !addingRoom}
                onClick={() => {
                  setUnitId(unitId === u.id ? null : u.id);
                  setAddingRoom(false);
                }}
              >
                {u.room_no}
              </button>
            ))}
            <button
              type="button"
              className="pick add"
              aria-pressed={addingRoom}
              onClick={() => {
                setAddingRoom(!addingRoom);
                setUnitId(null);
              }}
            >
              ＋ 番号
            </button>
          </div>
        )}
        {addingRoom && (
          <>
            <label htmlFor="new-room" className="visually-hidden">
              部屋番号
            </label>
            <input
              id="new-room"
              className="input"
              placeholder="部屋番号(例: 203)"
              value={newRoomNo}
              maxLength={50}
              onChange={(e) => setNewRoomNo(e.target.value)}
            />
          </>
        )}
        <p className="hint">
          {selected || newBuilding ? "選ばないときは「物件全体・共用部」になります。" : "先に物件を選ぶと、部屋が出ます。"}
        </p>
      </div>

      <div className="q">
        <div className="q-label">
          <span className="no">3</span>発注元<span className="req">必須</span>
        </div>
        {effectiveClient && !changingClient ? (
          <div className="prefill">
            <span>
              {effectiveClient.name}
              <small>{clientId ? "選んだ発注元" : "この物件のふだんの発注元"}</small>
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setChangingClient(true)}>
              変える
            </button>
          </div>
        ) : showClientSelect ? (
          <>
            <label htmlFor="client-select" className="visually-hidden">
              発注元
            </label>
            <select
              id="client-select"
              className="select"
              value={effectiveClientId ?? ""}
              onChange={(e) => {
                setClientId(e.target.value || null);
                setChangingClient(false);
              }}
            >
              <option value="">発注元を選ぶ</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <p className="hint">物件を選ぶと、ふだんの発注元が入ります。</p>
        )}
      </div>

      <div className="q">
        <div className="q-label">
          <span className="no">4</span>種類
        </div>
        <div className="seg" role="group" aria-label="種類">
          {WORK_KIND_ORDER.map((k) => (
            <button key={k} type="button" className="pick" aria-pressed={workKind === k} onClick={() => setWorkKind(k)}>
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="q">
        <div className="q-label">
          <span className="no">5</span>依頼の内容<span className="opt">任意・1行</span>
        </div>
        <input
          className="input"
          type="text"
          value={summary}
          maxLength={200}
          onChange={(e) => setSummary(e.target.value)}
          aria-label="依頼の内容"
          placeholder="例: 退去後の原状回復。立会いは 10/6"
        />
        <p className="hint">入居者のお名前は入れません。受付日は今日で入ります。</p>
      </div>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="quick-foot">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "登録中…" : "登録する"}
        </button>
      </div>
    </form>
  );
}
