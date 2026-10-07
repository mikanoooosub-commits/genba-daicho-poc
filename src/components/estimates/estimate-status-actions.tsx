"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Printer } from "lucide-react";

import {
  changeEstimateStatusAction,
  deleteDraftEstimateAction,
  reissueEstimateAction,
} from "@/lib/data/actions-estimates";
import { changeCaseStatusAction } from "@/lib/data/actions-cases";
import type { CaseStatus, Estimate } from "@/lib/types";

// 見積の状態の操作(提出 → 採用/不採用 → 出し直し・請求を作る)。
// 状態を進める・採用するのは人。ここは、人が押した操作を送るだけ。移れる先は DB のトリガーが決める。
// 提出・採用のあとの「案件の状態」は、提案を出すだけで、押すまで変えない(D94-7)。

export function EstimateStatusActions({
  estimate,
  isLatest,
  invoiceId,
  dirty = false,
  onSave,
  saving = false,
  totalText,
  saveNote,
}: {
  estimate: Estimate;
  /** 同じ番号で、これがいちばん新しい版か */
  isLatest: boolean;
  /** この見積から作った請求(取り消していないもの)の id */
  invoiceId: string | null;
  dirty?: boolean;
  /** 下書きの保存(見積の画面が渡す)。下書きのときだけ、提出の隣に「下書きを保存」を出す */
  onSave?: () => void;
  saving?: boolean;
  /** スマホで、固定の帯に出す合計(税込)の文字 */
  totalText?: string;
  /** 保存できなかったときの一言(保存ボタンの近くに出す。PL-004) */
  saveNote?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function changeStatus(status: "提出済" | "採用" | "不採用", confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError("");
    startTransition(async () => {
      const result = await changeEstimateStatusAction({ estimateId: estimate.id, status });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function reissue() {
    if (!window.confirm("この見積を出し直します。明細を写した新しい版(下書き)を作ります。元の版はそのまま残ります。")) return;
    setError("");
    startTransition(async () => {
      const result = await reissueEstimateAction({ estimateId: estimate.id });
      if (result && !result.ok) setError(result.error); // 成功すると redirect で画面が移る
    });
  }

  function discard() {
    if (!window.confirm("この下書きを取り消します。案件の画面には出なくなります(記録は残ります)。")) return;
    setError("");
    startTransition(async () => {
      const result = await deleteDraftEstimateAction({ estimateId: estimate.id });
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <div style={{ display: "grid", gap: "var(--sp-2)", justifyItems: "end" }}>
      <div className="actions">
        {estimate.status === "下書き" && dirty ? (
          // 未保存のあいだに別の画面へ移ると、入力した内容が消える。保存するまで押せなくする(PL-004)
          <>
            <span className="btn btn-ghost" aria-disabled="true" title="保存すると開けます">
              <Printer className="icon" aria-hidden="true" />
              見積書を見る・印刷
            </span>
            <span className="hint">保存すると開けます</span>
          </>
        ) : (
          <Link className="btn btn-ghost" href={`/estimates/${estimate.id}/print`}>
            <Printer className="icon" aria-hidden="true" />
            見積書を見る・印刷
          </Link>
        )}

        {estimate.status === "下書き" && (
          <>
            <button className="btn btn-danger" type="button" disabled={pending} onClick={discard}>
              下書きを取り消す
            </button>
            {/* 保存と提出は同じ場所に並べる。PC は見出しの右、スマホは下に固定(合計つき)。主は1つ: 保存が要るあいだは保存、保存したら提出 */}
            <div className="est-dock">
              {totalText && (
                <span className="dock-total">
                  合計(税込)
                  <b className="num">{totalText}</b>
                </span>
              )}
              {onSave && (
                <button
                  className={dirty ? "btn btn-primary" : "btn btn-secondary"}
                  type="button"
                  disabled={saving || pending || !dirty}
                  onClick={onSave}
                >
                  {saving ? "保存しています…" : "下書きを保存"}
                </button>
              )}
              <button
                className={dirty ? "btn btn-secondary" : "btn btn-primary"}
                type="button"
                disabled={pending || dirty}
                title={dirty ? "先に「下書きを保存」してください" : undefined}
                onClick={() =>
                  changeStatus(
                    "提出済",
                    "提出済にします。提出済の見積は書き換えられません(直すときは出し直しで版を増やします)。よろしいですか。"
                  )
                }
              >
                提出済にする
              </button>
            </div>
          </>
        )}

        {estimate.status === "提出済" && (
          <>
            {isLatest && (
              <button className="btn btn-secondary" type="button" disabled={pending} onClick={reissue}>
                出し直す(版を増やす)
              </button>
            )}
            <button className="btn btn-secondary" type="button" disabled={pending} onClick={() => changeStatus("不採用")}>
              不採用にする
            </button>
            {isLatest && (
              <button
                className="btn btn-primary"
                type="button"
                disabled={pending}
                onClick={() => changeStatus("採用", "この見積を採用にします。金額の確認はお済みですか。(あとで、請求がまだなら提出済に戻せます)")}
              >
                採用にする
              </button>
            )}
          </>
        )}

        {estimate.status === "採用" && (
          <>
            {invoiceId ? (
              <span className="flag flag-info">
                <FileText className="icon" aria-hidden="true" />
                請求を作成済み
              </span>
            ) : (
              <>
                <button className="btn btn-secondary" type="button" disabled={pending} onClick={() => changeStatus("提出済")}>
                  提出済に戻す
                </button>
                <Link className="btn btn-primary" href={`/estimates/${estimate.id}/invoice`}>
                  この見積から請求を作る
                </Link>
              </>
            )}
          </>
        )}

        {estimate.status === "不採用" && (
          <>
            <button className="btn btn-secondary" type="button" disabled={pending} onClick={() => changeStatus("提出済")}>
              提出済に戻す
            </button>
            {isLatest && (
              <button className="btn btn-secondary" type="button" disabled={pending} onClick={reissue}>
                出し直す(版を増やす)
              </button>
            )}
          </>
        )}
      </div>
      {saveNote && (
        <p className="error-text" role="alert">
          {saveNote}
        </p>
      )}
      {estimate.status === "提出済" && !isLatest && (
        <p className="hint">新しい版があるため、この版は採用・不採用にできません。</p>
      )}
      {estimate.status === "採用" && !invoiceId && (
        <p className="hint">出し直すときは、先に「提出済に戻す」を押します。</p>
      )}
      {error && (
        <div className="notice notice-danger" role="alert">
          <div>{error}</div>
        </div>
      )}
    </div>
  );
}

/** 見積の提出・採用のあとに、案件の状態を進める提案を出す(押すまで変えない) */
export function CaseStatusSuggestion({
  caseId,
  caseStatus,
  suggested,
  reason,
}: {
  caseId: string;
  caseStatus: CaseStatus;
  suggested: CaseStatus;
  reason: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();
  if (dismissed) return null;

  function apply() {
    setError("");
    startTransition(async () => {
      const result = await changeCaseStatusAction({ caseId, status: suggested });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="notice notice-info" role="status" style={{ marginBottom: "var(--sp-4)" }}>
      <div>
        <strong>案件の状態を「{suggested}」にしますか</strong>
        {reason}(いまは「{caseStatus}」です。押すまで変わりません)
        <div style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-2)", flexWrap: "wrap" }}>
          <button className="btn btn-secondary" type="button" disabled={pending} onClick={apply}>
            「{suggested}」にする
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setDismissed(true)}>
            このまま
          </button>
        </div>
        {error && <p role="alert" style={{ color: "var(--st-danger-fg)", marginTop: "var(--sp-2)" }}>{error}</p>}
      </div>
    </div>
  );
}
