"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCcw, Trash2 } from "lucide-react";

import { changeCaseStatusAction, setCaseDeletedAction } from "@/lib/data/actions-cases";
import { CASE_STATUS_ORDER, type CaseStatus } from "@/lib/types";

// 案件の状態の変更と、取り消し(論理削除)・元に戻す操作。物理削除はしない。
// 状態を進めるのは人。画面は提案を出すだけで、勝手には変えない(SPEC-v2 §3.3)。

/** 施工を記録したあとの提案(SPEC-v2 §3.3・見本 quick-entry.html の B)。施工が続くなら「このまま」を選ぶ */
function suggestedNext(status: CaseStatus, jobCount: number): CaseStatus | null {
  if (jobCount === 0) return null;
  if (status === "依頼" || status === "見積中" || status === "受注") return "施工中";
  if (status === "施工中") return "完了";
  return null;
}

export function CaseStatusControls({
  caseId,
  status,
  jobCount,
  hasInvoice,
  justRecordedJob = false,
}: {
  caseId: string;
  status: CaseStatus;
  jobCount: number;
  hasInvoice: boolean;
  /** 施工を記録した直後(?job=1)。提案の頭に一言添える */
  justRecordedJob?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [askingLost, setAskingLost] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [pending, startTransition] = useTransition();

  const suggestion = dismissed ? null : suggestedNext(status, jobCount);

  function change(next: CaseStatus, reason?: string) {
    setError("");
    startTransition(async () => {
      const result = await changeCaseStatusAction({ caseId, status: next, lostReason: reason });
      if (result.ok) {
        setAskingLost(false);
        setLostReason("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section className="card card-pad section-gap" aria-labelledby="status-h">
      <h2 id="status-h" style={{ fontSize: "var(--fs-lead)", marginBottom: "var(--sp-3)" }}>
        状態
      </h2>

      {suggestion && (
        <div className="notice notice-info suggest" role="status" style={{ marginBottom: "var(--sp-4)" }}>
          <div>
            {justRecordedJob && <strong>施工を記録しました。</strong>}
            <strong>この案件を「{suggestion}」にしますか?</strong>
            {suggestion === "完了"
              ? hasInvoice
                ? "請求はもう作ってあります。施工が続くなら「このまま」を選びます。"
                : "完了にすると、請求を作るまで一覧に「請求が未作成」と出ます。施工が続くなら「このまま」を選びます。"
              : "施工の記録があります。変えるかどうかは、ここで決めます。"}
            <span className="row" style={{ marginTop: "var(--sp-3)" }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => change(suggestion)}>
                {suggestion}にする
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => setDismissed(true)}>
                このまま
              </button>
            </span>
          </div>
        </div>
      )}

      <div className="field">
        <span className="label" id="status-pick">
          状態を変える(戻すときも、ここから選びます)
        </span>
        <div className="seg" role="group" aria-labelledby="status-pick">
          {CASE_STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className="pick"
              aria-pressed={status === s}
              disabled={pending || status === s}
              onClick={() => (s === "失注" ? setAskingLost(true) : change(s))}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {askingLost && (
        <div className="field" style={{ marginTop: "var(--sp-3)" }}>
          <label htmlFor="lost-reason">
            失注の理由<span className="opt">任意・1行</span>
          </label>
          <input
            id="lost-reason"
            className="input"
            value={lostReason}
            maxLength={200}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder="例: 価格が合わなかった"
          />
          <span style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-2)", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-danger btn-sm" disabled={pending} onClick={() => change("失注", lostReason)}>
              失注にする
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => setAskingLost(false)}>
              やめる
            </button>
          </span>
        </div>
      )}

      {error && (
        <p className="error-text" role="alert" style={{ marginTop: "var(--sp-3)" }}>
          {error}
        </p>
      )}
      <p className="hint" style={{ marginTop: "var(--sp-3)" }}>
        「請求済」「入金済」は、請求と入金から自動で決まります(ここでは選べません)。変更は履歴に残ります。
      </p>
    </section>
  );
}

/** 案件を取り消す。生きている請求・入金があるときは DB が断る(メッセージをそのまま出す) */
export function DeleteCaseButton({ caseId, jobCount }: { caseId: string; jobCount: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirming(true)}>
        <Trash2 className="icon" aria-hidden="true" />
        この案件を取り消す
      </button>
    );
  }

  function handleDelete() {
    setError("");
    startTransition(async () => {
      const result = await setCaseDeletedAction(caseId, true);
      // 成功すると Server Action が一覧へ redirect() するので、ここに戻るのは失敗のときだけ
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <div className="notice notice-danger" role="alertdialog" aria-label="案件を取り消す確認" style={{ flexBasis: "100%" }}>
      <AlertTriangle className="icon" aria-hidden="true" />
      <div>
        <strong>この案件を取り消しますか?</strong>
        {jobCount > 0 ? `施工 ${jobCount}件の記録は消さず残ります。` : ""}
        生きている請求や入金があるときは、先にそれらを取り消す必要があります。「案件」の一覧の下の「取り消した案件」から、いつでも元に戻せます。履歴は残ります。
        {error && (
          <span className="error-text" role="alert" style={{ display: "flex", marginTop: "var(--sp-2)" }}>
            {error}
          </span>
        )}
        <span style={{ display: "flex", gap: "var(--sp-2)", marginTop: "var(--sp-3)", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-danger btn-sm" onClick={handleDelete} disabled={pending}>
            {pending ? "取り消し中…" : "取り消す"}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirming(false)} disabled={pending}>
            やめる
          </button>
        </span>
      </div>
    </div>
  );
}

/** 取り消した案件を元に戻す */
export function RestoreCaseButton({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={pending}
        onClick={() => {
          setError("");
          startTransition(async () => {
            const result = await setCaseDeletedAction(caseId, false);
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
