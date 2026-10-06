"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { createInvoiceFromEstimateAction } from "@/lib/data/actions-estimates";

// 見積から請求を作る入力(請求日・様式のメモ・メモ)。金額と税率は見積のとおりで、ここでは直せない
// (DB が見積から写して固定する。直すときは見積を出し直す)。金額を決めるのは人 — 採用した時点で決まっている。
export function InvoiceFromEstimateForm({
  estimateId,
  today,
  formatHint,
}: {
  estimateId: string;
  /** 請求日の初期値(日本時間の今日・YYYY-MM-DD) */
  today: string;
  /** 発注元の請求書様式のメモ(あれば様式の欄の初期値) */
  formatHint: string;
}) {
  const uid = useId();
  const [issueDate, setIssueDate] = useState(today);
  const [formatPattern, setFormatPattern] = useState(formatHint);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await createInvoiceFromEstimateAction({ estimateId, issueDate, formatPattern, memo });
      if (result && !result.ok) setError(result.error); // 成功すると案件の画面へ移る
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: "var(--sp-4)" }}>
      <div className="field">
        <label htmlFor={`${uid}-date`}>請求日</label>
        <input id={`${uid}-date`} className="input" type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-fmt`}>
          請求書の様式<span className="muted"> 任意</span>
        </label>
        <input
          id={`${uid}-fmt`}
          className="input"
          value={formatPattern}
          maxLength={200}
          onChange={(e) => setFormatPattern(e.target.value)}
          placeholder="例: 管理会社Aの雛形"
        />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-memo`}>
          メモ<span className="muted"> 任意</span>
        </label>
        <textarea id={`${uid}-memo`} className="textarea" value={memo} maxLength={2000} onChange={(e) => setMemo(e.target.value)} />
      </div>
      {error && (
        <div className="notice notice-danger" role="alert">
          <div>{error}</div>
        </div>
      )}
      <div style={{ display: "flex", gap: "var(--sp-3)", justifyContent: "flex-end", flexWrap: "wrap" }}>
        <Link className="btn btn-secondary" href={`/estimates/${estimateId}`}>
          見積に戻る
        </Link>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "作っています…" : "請求を作る"}
        </button>
      </div>
      <p className="hint">
        請求を作ると、台帳の請求の合計に入ります。入金の登録は案件の画面から行います。作ったあとは案件の画面へ戻ります。金額は見積のとおりで、あとから直せません。
      </p>
    </form>
  );
}
