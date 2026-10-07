"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw, Trash2 } from "lucide-react";

import { setBuildingDeletedAction, setUnitDeletedAction } from "@/lib/data/actions-buildings";

// 物件・部屋の取り消し(論理削除)と元に戻す操作。物理削除はしない。
// 取り消しは確認の文を出してから行う(元に戻せること、ぶらさがる記録は残ることを伝える)。

/** 物件を取り消す。部屋・施工がぶらさがっていれば、件数を確認の文に出す */
export function DeleteBuildingButton({
  buildingId,
  unitCount,
  jobCount,
}: {
  buildingId: string;
  unitCount: number;
  jobCount: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
        <Trash2 className="icon" aria-hidden="true" />
        この物件を取り消す
      </button>
    );
  }

  function handleDelete() {
    setError("");
    startTransition(async () => {
      const result = await setBuildingDeletedAction(buildingId, true);
      // 成功すると Server Action が一覧へ redirect() するので、ここに戻るのは失敗のときだけ
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <div className="notice notice-danger" role="alertdialog" aria-label="物件を取り消す確認" style={{ flexBasis: "100%" }}>
      <AlertTriangle className="icon" aria-hidden="true" />
      <div>
        <strong>この物件を取り消しますか?</strong>
        {unitCount > 0 || jobCount > 0
          ? `部屋 ${unitCount}室・施工 ${jobCount}件がぶらさがっています。それらは消さず、物件の一覧と画面から見えなくなります。`
          : "部屋や施工はぶらさがっていません。"}
        「物件」の一覧の下の「取り消した物件」から、いつでも元に戻せます。履歴は残ります。
        {error && (
          <span className="error-text" role="alert" style={{ display: "flex", marginTop: "var(--sp-2)" }}>
            {error}
          </span>
        )}
        <span style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-3)", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={pending}>
            {pending ? "取り消し中…" : "取り消す"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={pending}>
            やめる
          </button>
        </span>
      </div>
    </div>
  );
}

/** 取り消した物件を元に戻す */
export function RestoreBuildingButton({ buildingId }: { buildingId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() => {
          setError("");
          startTransition(async () => {
            const result = await setBuildingDeletedAction(buildingId, false);
            if (result.ok) router.refresh();
            else setError(result.error);
          });
        }}
      >
        <RotateCcw className="icon" aria-hidden="true" />
        {pending ? "戻し中…" : "元に戻す"}
      </button>
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

/** 部屋を取り消す/元に戻す(確認なしの小さな操作。戻せるため。履歴は残る) */
export function UnitDeletedButton({ unitId, restore }: { unitId: string; restore: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className={restore ? "btn btn-secondary" : "btn btn-ghost"}
        disabled={pending}
        onClick={() => {
          setError("");
          startTransition(async () => {
            const result = await setUnitDeletedAction(unitId, !restore);
            if (result.ok) router.refresh();
            else setError(result.error);
          });
        }}
      >
        {restore ? <RotateCcw className="icon" aria-hidden="true" /> : <Trash2 className="icon" aria-hidden="true" />}
        {restore ? "元に戻す" : "部屋を取り消す"}
      </button>
      {error && (
        <span className="error-text" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
