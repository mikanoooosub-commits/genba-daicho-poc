"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus } from "lucide-react";

import { copyEstimateItemsAction, saveEstimateAction } from "@/lib/data/actions-estimates";
import type { ReferenceCase, ReferenceGroupKey } from "@/lib/data/queries-estimates";
import { EstimateStatusActions } from "@/components/estimates/estimate-status-actions";
import { formatDate, formatSignedYen, formatYen } from "@/lib/format";
import type { Estimate, EstimateCategory, EstimateItem } from "@/lib/types";
import {
  ESTIMATE_CATEGORIES,
  UNIT_SUGGESTIONS,
  calcItemAmountYen,
  calcTaxYen,
  estimateItemInputSchema,
  type EstimateItemInput,
} from "@/lib/validation/estimate";

// 見積の編集と「前回の見積と施工」(SPEC-v2 §5.5・見本 form-estimate.html)。
// 合計は、保存のたびにサーバー(DB)が計算した値を出す。編集中(未保存)の数字は「試算」と書き、保存すると確定する。
// 提出済以降(editable=false)は、読むだけ。直すときは「出し直し」で版を増やす(DB が守る)。
// 前回の見積から写すのは、内容・区分・数量・単位・単価だけ。金額は写した先で DB が計算し直す。

type Row = {
  key: string;
  id?: string;
  category: EstimateCategory;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string; // 値引きも正の金額で入れる(保存のときに符号を反転する)
  copiedFromItemId?: string;
  copiedNote?: string; // 「前回から写した」の印の文言
};

const TAX_OPTIONS = [10, 8, 0] as const;
const GROUP_LABEL: Record<ReferenceGroupKey, string> = {
  room: "同じ部屋",
  building: "同じ物件",
  client: "同じ発注元",
};

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `r${keyCounter}`;
}

function toRow(item: EstimateItem): Row {
  return {
    key: nextKey(),
    id: item.id,
    category: item.category,
    description: item.description,
    quantity: String(item.quantity),
    unit: item.unit ?? "",
    unitPrice: String(Math.abs(item.unit_price_yen)),
    copiedFromItemId: item.copied_from_item_id ?? undefined,
    copiedNote: item.copied_from_item_id ? "↳ 前の見積から写した" : undefined,
  };
}

function parseNumber(s: string): number {
  const t = s.replace(/[,\s、]/g, "");
  return t === "" ? Number.NaN : Number(t);
}

function rowAmount(row: Row): number | null {
  const q = parseNumber(row.quantity);
  const p = parseNumber(row.unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return null;
  const amount = calcItemAmountYen(q, Math.trunc(p));
  return row.category === "値引き" ? -Math.abs(amount) : amount;
}

export function EstimateWorkspace({
  estimate,
  items,
  editable,
  clientName,
  references,
  includeLost,
  isLatest,
  invoiceId,
}: {
  estimate: Estimate;
  items: EstimateItem[];
  editable: boolean;
  clientName: string;
  references: ReferenceCase[];
  includeLost: boolean;
  isLatest: boolean;
  invoiceId: string | null;
}) {
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => items.map(toRow));
  const [taxRate, setTaxRate] = useState<number>(estimate.tax_rate_pct);
  const [validUntil, setValidUntil] = useState(estimate.valid_until ?? "");
  const [note, setNote] = useState(estimate.note ?? "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [groupTab, setGroupTab] = useState<ReferenceGroupKey>(() => {
    for (const g of ["room", "building", "client"] as const) {
      if (references.some((r) => r.group === g)) return g;
    }
    return "room";
  });

  const initial = useMemo(
    () =>
      JSON.stringify({
        rows: items.map((i) => [i.id, i.category, i.description, String(i.quantity), i.unit ?? "", String(Math.abs(i.unit_price_yen))]),
        taxRate: estimate.tax_rate_pct,
        validUntil: estimate.valid_until ?? "",
        note: estimate.note ?? "",
      }),
    [items, estimate]
  );
  const current = JSON.stringify({
    rows: rows.map((r) => [r.id, r.category, r.description, r.quantity, r.unit, r.unitPrice]),
    taxRate,
    validUntil,
    note,
  });
  const dirty = editable && current !== initial;

  // 編集中の試算(保存すると DB が計算した値に置き換わる)
  const trial = useMemo(() => {
    const amounts = rows.map(rowAmount);
    if (amounts.some((a) => a === null)) return null;
    const subtotal = amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0);
    const tax = calcTaxYen(subtotal, taxRate);
    return { subtotal, tax, total: subtotal + tax };
  }, [rows, taxRate]);
  const totals = dirty
    ? trial
    : { subtotal: estimate.subtotal_yen, tax: estimate.tax_yen, total: estimate.total_yen };

  function update(key: string, patch: Partial<Row>) {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addRow(partial: Partial<Row> = {}) {
    setSaved(false);
    setRows((rs) => [...rs, { key: nextKey(), category: "施工費", description: "", quantity: "1", unit: "", unitPrice: "", ...partial }]);
  }
  function removeRow(key: string) {
    setSaved(false);
    setRows((rs) => rs.filter((r) => r.key !== key));
  }

  function save() {
    setError("");
    const payloadItems: EstimateItemInput[] = [];
    for (const [i, r] of rows.entries()) {
      const parsed = estimateItemInputSchema.safeParse({
        id: r.id,
        category: r.category,
        description: r.description,
        quantity: parseNumber(r.quantity),
        unit: r.unit,
        unitPrice: parseNumber(r.unitPrice),
        copiedFromItemId: r.copiedFromItemId,
      });
      if (!parsed.success) {
        setError(`${i + 1}行目: ${parsed.error.issues[0]?.message ?? "入力を確かめてください"}`);
        return;
      }
      payloadItems.push(parsed.data);
    }
    startTransition(async () => {
      const result = await saveEstimateAction({
        estimateId: estimate.id,
        taxRatePct: taxRate === 8 ? 8 : taxRate === 0 ? 0 : 10,
        note,
        validUntil,
        items: payloadItems,
      });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function copyItems(sourceItemIds: string[]) {
    setError("");
    startTransition(async () => {
      const result = await copyEstimateItemsAction({ estimateId: estimate.id, sourceItemIds });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function addFromJob(job: ReferenceCase["jobs"][number], caseNo: string) {
    // 施工の内容から、明細を1行つくる(単価は空。金額は人が決める)
    const text = [job.work_type, job.content].filter(Boolean).join(" ").slice(0, 200);
    addRow({ description: text, unit: "式", copiedNote: `↳ ${caseNo} の施工(${formatDate(job.job_date)})から` });
  }

  const visibleRefs = references.filter((r) => r.group === groupTab);
  const refCounts = (g: ReferenceGroupKey) => references.filter((r) => r.group === g).length;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "var(--sp-4)" }}>
        <EstimateStatusActions
          estimate={estimate}
          isLatest={isLatest}
          invoiceId={invoiceId}
          dirty={dirty}
          onSave={editable ? save : undefined}
          saving={pending}
          totalText={totals ? formatSignedYen(totals.total) : undefined}
        />
      </div>
    <div className="est-grid">
      {/* 左: 見積の本体 */}
      <section className="card" aria-label="見積の明細">
        <div className="meta-row">
          <div className="field">
            <span className="label">宛先(請求先)</span>
            <span style={{ minHeight: 44, display: "flex", alignItems: "center" }}>{clientName}</span>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-valid`}>有効期限</label>
            {editable ? (
              <input
                id={`${uid}-valid`}
                className="input"
                type="date"
                value={validUntil}
                onChange={(e) => {
                  setSaved(false);
                  setValidUntil(e.target.value);
                }}
              />
            ) : (
              <span style={{ minHeight: 44, display: "flex", alignItems: "center" }}>
                {estimate.valid_until ? formatDate(estimate.valid_until) : "—"}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${uid}-tax`}>税率</label>
            {editable ? (
              <select
                id={`${uid}-tax`}
                className="select"
                value={taxRate}
                onChange={(e) => {
                  setSaved(false);
                  setTaxRate(Number(e.target.value));
                }}
              >
                {TAX_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}%
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ minHeight: 44, display: "flex", alignItems: "center" }}>{estimate.tax_rate_pct}%</span>
            )}
          </div>
        </div>

        <p className="caption table-note">金額はすべて税抜です。</p>
        <table className={editable ? "items-table" : "items-table items-readonly"}>
          <thead>
            <tr>
              <th scope="col" style={{ width: 110 }}>区分</th>
              <th scope="col">内容</th>
              <th scope="col" className="r" style={{ width: 84 }}>数量</th>
              <th scope="col" style={{ width: 76 }}>単位</th>
              <th scope="col" className="r" style={{ width: 110 }}>単価(税抜)</th>
              <th scope="col" className="r" style={{ width: 104 }}>金額</th>
              {editable && (
                <th scope="col" style={{ width: 40 }}>
                  <span className="visually-hidden">行の削除</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const amount = rowAmount(r);
              const label = `${idx + 1}行目`;
              return (
                <tr key={r.key} className={r.category === "値引き" ? "discount" : undefined}>
                  <td className="c-cat" data-label="区分">
                    {editable ? (
                      <select
                        className="select"
                        aria-label={`${label}の区分`}
                        value={r.category}
                        onChange={(e) => {
                          const c = ESTIMATE_CATEGORIES.find((x) => x === e.target.value);
                          if (c) update(r.key, { category: c });
                        }}
                      >
                        {ESTIMATE_CATEGORIES.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="readonly-cell">{r.category}</span>
                    )}
                  </td>
                  <td className="c-desc" data-label="内容">
                    {editable ? (
                      <input
                        className="input"
                        aria-label={`${label}の内容`}
                        value={r.description}
                        maxLength={200}
                        onChange={(e) => update(r.key, { description: e.target.value })}
                      />
                    ) : (
                      <span className="readonly-cell">{r.description}</span>
                    )}
                    {r.copiedNote && <span className="copied">{r.copiedNote}</span>}
                  </td>
                  <td data-label="数量">
                    {editable ? (
                      <input
                        className="input input-num"
                        inputMode="decimal"
                        aria-label={`${label}の数量`}
                        value={r.quantity}
                        onChange={(e) => update(r.key, { quantity: e.target.value })}
                      />
                    ) : (
                      <span className="readonly-cell num" style={{ textAlign: "right" }}>{r.quantity}</span>
                    )}
                  </td>
                  <td data-label="単位">
                    {editable ? (
                      <input
                        className="input"
                        list={`${uid}-units`}
                        aria-label={`${label}の単位`}
                        value={r.unit}
                        maxLength={20}
                        onChange={(e) => update(r.key, { unit: e.target.value })}
                      />
                    ) : (
                      <span className="readonly-cell">{r.unit}</span>
                    )}
                  </td>
                  <td data-label={r.category === "値引き" ? "値引き額(正の金額)" : "単価"}>
                    {editable ? (
                      <input
                        className="input input-num"
                        inputMode="numeric"
                        aria-label={`${label}の単価${r.category === "値引き" ? "(値引きの金額。正の数で入れる)" : ""}`}
                        value={r.unitPrice}
                        onChange={(e) => update(r.key, { unitPrice: e.target.value })}
                      />
                    ) : (
                      <span className="readonly-cell num" style={{ textAlign: "right" }}>
                        {formatSignedYen(r.category === "値引き" ? -Math.abs(parseNumber(r.unitPrice)) : parseNumber(r.unitPrice))}
                      </span>
                    )}
                  </td>
                  <td className="c-amt amount" data-label="金額">
                    {amount === null ? "—" : formatSignedYen(amount)}
                  </td>
                  {editable && (
                    <td className="c-del">
                      <button type="button" className="row-del" aria-label={`${label}を外す`} onClick={() => removeRow(r.key)}>
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="muted" style={{ padding: "var(--sp-5)", borderBottom: "1px solid var(--line)" }}>
            明細がまだありません。{editable ? "「行を足す」か、右の前回の見積から写してください。" : ""}
          </p>
        )}
        <datalist id={`${uid}-units`}>
          {UNIT_SUGGESTIONS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>

        {editable && (
          <div className="add-row">
            <button className="btn btn-secondary" type="button" onClick={() => addRow()}>
              <Plus className="icon" aria-hidden="true" />
              行を足す
            </button>
            <span className="hint">値引きは、区分を「値引き」にして、正の金額で入れます。</span>
          </div>
        )}

        <div className="totals">
          <div className="field">
            <label htmlFor={`${uid}-note`}>
              備考(見積書に載ります)<span className="muted"> 任意</span>
            </label>
            {editable ? (
              <textarea
                id={`${uid}-note`}
                className="textarea"
                value={note}
                maxLength={1000}
                onChange={(e) => {
                  setSaved(false);
                  setNote(e.target.value);
                }}
              />
            ) : (
              <p style={{ whiteSpace: "pre-wrap" }}>{estimate.note ?? <span className="muted">なし</span>}</p>
            )}
            <p className="hint">入居者のお名前は入れません(預かる情報を減らすため)。</p>
          </div>
          <dl aria-label="合計">
            <dt>小計(税抜)</dt>
            <dd>{totals ? formatSignedYen(totals.subtotal) : "—"}</dd>
            <dt>消費税({editable ? taxRate : estimate.tax_rate_pct}%・1円未満切り捨て)</dt>
            <dd>{totals ? formatSignedYen(totals.tax) : "—"}</dd>
            <dt className="grand">合計(税込)</dt>
            <dd className="grand">{totals ? formatSignedYen(totals.total) : "—"}</dd>
          </dl>
        </div>

        {editable && (
          <div style={{ padding: "0 var(--sp-5) var(--sp-5)", display: "grid", gap: "var(--sp-2)" }}>
            {dirty && (
              <p className="hint" role="status">
                未保存の変更があります。上の合計は「試算」です。保存すると、計算し直して確定します。
              </p>
            )}
            {saved && !dirty && !error && (
              <p className="hint" role="status">
                保存しました。合計は保存時に計算し直した値です。
              </p>
            )}
            {error && (
              <div className="notice notice-danger" role="alert">
                <div>{error}</div>
              </div>
            )}
          </div>
        )}
        {!editable && error && (
          <div className="notice notice-danger" role="alert" style={{ margin: "0 var(--sp-5) var(--sp-5)" }}>
            <div>{error}</div>
          </div>
        )}
      </section>

      {/* 右: 前回の見積と施工 */}
      <aside className="card ref" aria-labelledby={`${uid}-ref-h`}>
        <div className="card-head">
          <h2 id={`${uid}-ref-h`} style={{ fontSize: "var(--fs-h3)" }}>前回の見積と施工</h2>
        </div>
        <div className="tabs" role="tablist" aria-label="前回の見積の絞り込み">
          {(["room", "building", "client"] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={groupTab === g}
              onClick={() => setGroupTab(g)}
            >
              {GROUP_LABEL[g]} <span className="badge">{refCounts(g)}</span>
            </button>
          ))}
        </div>
        <ul className="ref-list">
          {visibleRefs.length === 0 && (
            <li className="notice notice-info">
              <span>
                {GROUP_LABEL[groupTab]}の、前回の見積と施工はありません。
                {groupTab === "room" && references.length > 0 ? "他のタブを見てください。" : ""}
              </span>
            </li>
          )}
          {visibleRefs.map((ref) => (
            <li key={ref.caseId} className="ref-item">
              <header>
                <span>
                  <span className={ref.estimate ? "tag tag-est" : "tag tag-job"}>{ref.estimate ? "見積" : "施工"}</span>{" "}
                  <span className="t">
                    {ref.estimate ? `${ref.estimate.estimate_no} 第${ref.estimate.version}版` : ref.caseNo}
                  </span>
                </span>
                <span className="when num">{formatDate(ref.estimate?.issue_date ?? ref.receivedOn)}</span>
              </header>
              <p className="muted">
                {ref.buildingName}
                {ref.roomNo ? ` ${ref.roomNo}` : ""}・{ref.clientName}
                {ref.caseStatus === "失注" ? "・失注した案件" : ""}
                {ref.estimate ? `・${ref.estimate.status}・税抜 ${formatYen(ref.estimate.subtotal_yen)}` : "・見積なし(旧画面から移した案件など)"}
              </p>
              {ref.items.length > 0 && (
                <>
                  <ul className="ref-lines">
                    {ref.items.map((it) => (
                      <li key={it.id}>
                        <span className="l">
                          {it.description} {it.quantity}
                          {it.unit ?? ""}
                        </span>
                        <span className="p">@{formatSignedYen(it.unit_price_yen)}</span>
                        {editable && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={pending || dirty}
                            onClick={() => copyItems([it.id])}
                            aria-label={`「${it.description}」の明細を1行写す`}
                          >
                            写す
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  {editable && (
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={pending || dirty}
                      onClick={() => copyItems(ref.items.map((it) => it.id))}
                    >
                      <Copy className="icon" aria-hidden="true" />
                      明細を全部写す({ref.items.length}行)
                    </button>
                  )}
                </>
              )}
              {ref.jobs.length > 0 && (
                <ul className="ref-lines">
                  {ref.jobs.map((j, i) => (
                    <li key={`${j.job_date}-${i}`}>
                      <span className="l">
                        <span className="tag tag-job">施工</span> {j.work_type ?? "(工種なし)"}
                        {j.content ? `・${j.content}` : ""}
                      </span>
                      <span className="p">{formatDate(j.job_date)}</span>
                      {editable && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => addFromJob(j, ref.caseNo)}
                          aria-label="この施工の内容で明細を1行つくる"
                        >
                          明細に
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <div style={{ padding: "0 var(--sp-4) var(--sp-4)", display: "grid", gap: "var(--sp-2)" }}>
          <a className="btn btn-ghost" href={includeLost ? "?" : "?lost=1"} style={{ justifySelf: "start" }}>
            {includeLost ? "失注した案件を含めない" : "失注した案件も含める"}
          </a>
          <p className="caption muted">
            写した単価は下書きに入るだけです。金額はご自身で確かめてから提出します。
            {editable && dirty ? "(未保存の変更があるあいだは、写せません。先に保存してください)" : ""}
          </p>
        </div>
      </aside>
    </div>
    </>
  );
}
