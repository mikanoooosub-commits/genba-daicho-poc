"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { updateCaseAction } from "@/lib/data/actions-cases";
import {
  LEAD_SOURCE_ORDER,
  WORK_KIND_ORDER,
  type Client,
  type LeadSource,
  type WorkKind,
} from "@/lib/types";

// 案件の編集(依頼の内容・種類・受付日・集客経路・発注元)。打ち間違いを直す画面。
// 物件・部屋は変えない。発注元・集客経路を直すと、DB のトリガーが現場(sites 行)にも写す。
// 変更は監査ログに残る(案件の画面の「変更履歴」)。

type Props = {
  caseId: string;
  caseNo: string;
  placeLabel: string;
  clients: Client[];
  initial: {
    clientId: string;
    workKind: WorkKind;
    leadSource: LeadSource;
    receivedOn: string;
    requestSummary: string;
  };
};

export function CaseEditForm({ caseId, caseNo, placeLabel, clients, initial }: Props) {
  const [clientId, setClientId] = useState(initial.clientId);
  const [workKind, setWorkKind] = useState<WorkKind>(initial.workKind);
  const [leadSource, setLeadSource] = useState<LeadSource>(initial.leadSource);
  const [receivedOn, setReceivedOn] = useState(initial.receivedOn);
  const [summary, setSummary] = useState(initial.requestSummary);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await updateCaseAction({
        caseId,
        clientId,
        workKind,
        leadSource,
        receivedOn,
        requestSummary: summary.trim() || undefined,
      });
      // 成功すると Server Action が案件の画面へ redirect() するので、ここに戻るのは失敗のときだけ
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <form className="quick" onSubmit={handleSubmit} noValidate>
      <div className="case-chip">
        <b>{placeLabel}</b>
        <span className="caption">{caseNo}・物件と部屋は、ここでは変えられません</span>
      </div>

      <div className="q">
        <div className="q-label">発注元(請求先)</div>
        <select
          className="select"
          aria-label="発注元"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="hint">直すと、台帳の発注元の集計にも反映されます。</p>
      </div>

      <div className="q">
        <div className="q-label">種類</div>
        <div className="seg" role="group" aria-label="種類">
          {WORK_KIND_ORDER.map((k) => (
            <button key={k} type="button" className="pick" aria-pressed={workKind === k} onClick={() => setWorkKind(k)}>
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="q">
        <div className="q-label">集客経路</div>
        <div className="seg" role="group" aria-label="集客経路">
          {LEAD_SOURCE_ORDER.map((s) => (
            <button key={s} type="button" className="pick" aria-pressed={leadSource === s} onClick={() => setLeadSource(s)}>
              {s}
            </button>
          ))}
        </div>
        <p className="hint">登録のときは、発注元の種類から決めています。違うときはここで直します。</p>
      </div>

      <div className="q">
        <label className="q-label" htmlFor="ce-date">
          受付日
        </label>
        <input id="ce-date" className="input" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
      </div>

      <div className="q">
        <label className="q-label" htmlFor="ce-summary">
          依頼の内容<span className="opt">任意・1行</span>
        </label>
        <input
          id="ce-summary"
          className="input"
          type="text"
          value={summary}
          maxLength={200}
          onChange={(e) => setSummary(e.target.value)}
        />
        <p className="hint">入居者のお名前は入れません。</p>
      </div>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="quick-foot">
        <div className="quick-foot-row">
          <Link className="btn btn-secondary" href={`/cases/${caseId}`}>
            やめる
          </Link>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
    </form>
  );
}
