"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { createCostAction, setCostDeletedAction } from "@/lib/data/actions-estimates";
import { formatDate, formatSignedYen, formatYen } from "@/lib/format";
import type { CaseFinancials, Cost, CostCategory } from "@/lib/types";
import { COST_CATEGORIES } from "@/lib/validation/estimate";

// 案件の画面の「原価」と「粗利」(WO-011 段階3・D94-1・4)。
// 粗利は税抜 = 売上(税抜)− 原価(税抜)。売上の根拠は 請求 / 見込み / 内訳なし / 未定 を文字で示す(色だけに頼らない)。
// 原価は税抜で入れる。領収書が税込のときは「税込から計算する」で、税抜(切り捨て)を欄に入れる。保存されるのは税抜だけ。

const BASIS_TEXT: Record<CaseFinancials["revenue_basis"], string> = {
  請求: "確定(請求の根拠)",
  見込み: "見込み(採用した見積)",
  内訳なし: "内訳なし",
  未定: "未定",
};

function basisHelp(f: CaseFinancials): string {
  switch (f.revenue_basis) {
    case "請求":
      return "請求を作った見積の小計(税抜)と、原価(税抜)から出しています。";
    case "見込み":
      return "請求がまだないので、採用した見積の小計(税抜)で見込んでいます。請求を作ると確定します。";
    case "内訳なし":
      return "見積に結びつかない請求(旧画面で作った請求など)があり、税抜の売上が分かりません。そのため粗利は出しません。税込の金額からの逆算もしません。";
    case "未定":
      return "採用した見積も請求もないので、売上が決まっていません。";
  }
}

/** 税込の金額から税抜(1円未満切り捨て)を出す。保存はしない(欄に入れるだけ) */
function excludeTax(taxIncluded: number, ratePct: number): number {
  return Math.floor((taxIncluded * 100) / (100 + ratePct));
}

export function CaseCostsSection({
  caseId,
  costs,
  financials,
  today,
  disabled,
}: {
  caseId: string;
  costs: Cost[];
  financials: CaseFinancials | null;
  /** 日付の初期値(日本時間の今日・YYYY-MM-DD) */
  today: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<CostCategory>("外注費");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [costDate, setCostDate] = useState(today);
  const [error, setError] = useState("");

  function parseAmount(s: string): number {
    const t = s.replace(/[,\s、]/g, "");
    return t === "" ? Number.NaN : Number(t);
  }

  function applyTax(rate: number) {
    const v = parseAmount(amount);
    if (!Number.isFinite(v) || v < 0) {
      setError("先に、税込の金額を入れてください");
      return;
    }
    setError("");
    setAmount(String(excludeTax(Math.trunc(v), rate)));
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await createCostAction({
        caseId,
        category,
        description,
        amountYen: parseAmount(amount),
        costDate,
        memo: undefined,
      });
      if (result.ok) {
        setDescription("");
        setAmount("");
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function remove(cost: Cost) {
    if (!window.confirm(`原価「${cost.description}」(${formatYen(cost.amount_yen)})を取り消します。記録は残ります。`)) return;
    setError("");
    startTransition(async () => {
      const result = await setCostDeletedAction({ costId: cost.id, isDeleted: true });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  const costTotal = financials?.cost_total_yen ?? costs.reduce((s, c) => s + c.amount_yen, 0);

  return (
    <section className="card card-sec section-gap" aria-labelledby="costs-h">
      <div className="sec-head">
        <h2 id="costs-h">
          原価と粗利<small>(税抜)</small>
        </h2>
      </div>
      {!disabled && !open && (
        <div className="sec-action">
          <button className="btn btn-secondary" type="button" onClick={() => setOpen(true)}>
            <Plus className="icon" aria-hidden="true" />
            原価を入れる
          </button>
        </div>
      )}
      <div className="sec-body">

      {financials && (
        <>
          <dl className="profit-box" aria-label="粗利(税抜)">
            <div>
              <dt>売上(税抜)</dt>
              <dd>{financials.revenue_yen === null ? "—" : formatSignedYen(financials.revenue_yen)}</dd>
            </div>
            <div>
              <dt>原価(税抜)</dt>
              <dd>{formatYen(costTotal)}</dd>
            </div>
            <div>
              <dt>粗利(税抜)</dt>
              <dd>{financials.gross_profit_yen === null ? "—" : formatSignedYen(financials.gross_profit_yen)}</dd>
            </div>
          </dl>
          <p style={{ marginTop: "var(--sp-2)" }}>
            <span className={financials.revenue_basis === "請求" ? "flag flag-info" : "flag flag-warn"}>
              売上の根拠: {BASIS_TEXT[financials.revenue_basis]}
            </span>{" "}
            <span className="hint">{basisHelp(financials)}</span>
          </p>
        </>
      )}

      {costs.length === 0 ? (
        <p className="muted">
          原価はまだありません。外注費・材料費・経費を入れると、粗利が見えます。
        </p>
      ) : (
        <ul className="est-list">
          {costs.map((c) => (
            <li key={c.id}>
              <span className="tag tag-est">{c.category}</span>
              <span className="grow">
                {c.description}
                <span className="muted num"> ・{formatDate(c.cost_date)}</span>
              </span>
              <span className="num" style={{ minWidth: 110, textAlign: "right" }}>
                {formatYen(c.amount_yen)}
              </span>
              {!disabled && (
                <button className="btn btn-ghost" type="button" disabled={pending} onClick={() => remove(c)}>
                  取り消す
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && !disabled && (
        <form onSubmit={add} style={{ display: "grid", gap: "var(--sp-3)", marginTop: "var(--sp-4)", borderTop: "1px solid var(--line)", paddingTop: "var(--sp-4)" }}>
          <div className="field">
            <span className="label">区分</span>
            <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }} role="group" aria-label="区分">
              {COST_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={category === c ? "btn btn-secondary pick-on" : "btn btn-secondary"}
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-desc`}>内容</label>
            <input
              id={`${uid}-desc`}
              className="input"
              required
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例: クロス職人 2人工(○○内装)"
            />
            <p className="hint">外注先は屋号までにし、個人名は書きません。</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "var(--sp-3)" }}>
            <div className="field">
              <label htmlFor={`${uid}-amt`}>金額(税抜・円)</label>
              <input
                id={`${uid}-amt`}
                className="input input-num"
                required
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center", flexWrap: "wrap" }}>
                <span className="hint">税込の金額から計算する:</span>
                <button className="btn btn-ghost" type="button" onClick={() => applyTax(10)}>
                  10%
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => applyTax(8)}>
                  8%
                </button>
              </div>
              <p className="hint">税込の金額を入れて押すと、税抜(1円未満切り捨て)に置き換わります。保存されるのは税抜だけです。</p>
            </div>
            <div className="field">
              <label htmlFor={`${uid}-date`}>日付</label>
              <input id={`${uid}-date`} className="input" type="date" required value={costDate} onChange={(e) => setCostDate(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className="btn btn-secondary" type="button" onClick={() => { setOpen(false); setError(""); }}>
              やめる
            </button>
            <button className="btn btn-primary" type="submit" disabled={pending}>
              {pending ? "入れています…" : "原価を入れる"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="notice notice-danger" role="alert" style={{ marginTop: "var(--sp-3)" }}>
          <div>{error}</div>
        </div>
      )}
      </div>
    </section>
  );
}
