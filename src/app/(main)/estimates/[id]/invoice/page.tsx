import Link from "next/link";
import { notFound } from "next/navigation";

import { InvoiceFromEstimateForm } from "@/components/estimates/invoice-from-estimate-form";
import { getCaseById, getCaseOverviewById } from "@/lib/data/queries-cases";
import { getEstimateById, getEstimateItems, getInvoiceIdByEstimate } from "@/lib/data/queries-estimates";
import { getClients } from "@/lib/data/queries-sites";
import { formatSignedYen, formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

/** 日本時間の今日(YYYY-MM-DD)。サーバーの時刻帯(Vercel は UTC)に左右されない */
function todayInTokyo(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

// 見積から請求を作る(WO-011 段階3・D94-1・2)。金額(税込)と税率は見積のとおり。ここでは直せない
// (DB が見積から写して固定する。直すときは見積を出し直す)。請求の内訳の表は作らない(段階4 で請求書の印刷を決める)。
export default async function InvoiceFromEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const estimate = await getEstimateById(id);
  if (!estimate) notFound();
  const kase = await getCaseById(estimate.case_id);
  if (!kase) notFound();

  const [overview, clients, items, existingInvoiceId] = await Promise.all([
    getCaseOverviewById(kase.id),
    getClients(true),
    getEstimateItems(estimate.id),
    getInvoiceIdByEstimate(estimate.id),
  ]);
  const client = clients.find((c) => c.id === kase.client_id);
  const place = overview ? (overview.room_no ? `${overview.building_name} ${overview.room_no}` : overview.building_name) : kase.case_no;

  const blocked = estimate.status !== "採用" ? "採用した見積からだけ請求を作れます。" : kase.is_deleted ? "この案件は取り消し済みです。" : null;

  return (
    <>
      <p className="breadcrumb">
        <Link href="/cases">案件</Link> › <Link href={`/cases/${kase.id}`}>{kase.case_no} {place}</Link> ›{" "}
        <Link href={`/estimates/${estimate.id}`}>見積 {estimate.estimate_no}</Link> › 請求を作る
      </p>
      <h1 style={{ marginBottom: "var(--sp-4)" }}>見積から請求を作る</h1>

      <section className="card card-pad" aria-labelledby="inv-sum-h" style={{ marginBottom: "var(--sp-4)" }}>
        <h2 id="inv-sum-h" style={{ fontSize: "var(--fs-lead)", marginBottom: "var(--sp-3)" }}>請求の内容(見積のとおり)</h2>
        <dl className="dl">
          <dt>請求先</dt>
          <dd>{client?.name ?? "発注元不明"}</dd>
          <dt>案件</dt>
          <dd>{kase.case_no} {place}</dd>
          <dt>見積</dt>
          <dd>
            {estimate.estimate_no} 第{estimate.version}版(採用)
          </dd>
          <dt>小計(税抜)</dt>
          <dd className="num">{formatSignedYen(estimate.subtotal_yen)}</dd>
          <dt>消費税({estimate.tax_rate_pct}%)</dt>
          <dd className="num">{formatSignedYen(estimate.tax_yen)}</dd>
          <dt>請求の金額(税込)</dt>
          <dd className="num">
            <strong style={{ fontSize: "var(--fs-lead)" }}>{formatYen(estimate.total_yen)}</strong>
          </dd>
        </dl>
        {items.length > 0 && (
          <details style={{ marginTop: "var(--sp-3)" }}>
            <summary>明細を見る({items.length}行)</summary>
            <ul className="ref-lines" style={{ marginTop: "var(--sp-2)" }}>
              {items.map((it) => (
                <li key={it.id}>
                  <span className="l">
                    {it.description} {it.quantity}
                    {it.unit ?? ""}
                  </span>
                  <span className="p">{formatSignedYen(it.amount_yen)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="hint" style={{ marginTop: "var(--sp-3)" }}>
          金額と税率は見積のとおりで、ここでは直せません。直すときは、見積を出し直します。
        </p>
      </section>

      {blocked ? (
        <div className="notice notice-warn" role="status">
          <div>{blocked}</div>
        </div>
      ) : existingInvoiceId ? (
        <div className="notice notice-info" role="status">
          <div>
            この見積からは、請求を作成済みです。<Link href={`/cases/${kase.id}`}>案件の画面で確かめる ›</Link>
          </div>
        </div>
      ) : (
        <section className="card card-pad" aria-labelledby="inv-form-h">
          <h2 id="inv-form-h" style={{ fontSize: "var(--fs-lead)", marginBottom: "var(--sp-3)" }}>請求日と様式</h2>
          <InvoiceFromEstimateForm estimateId={estimate.id} today={todayInTokyo()} formatHint={""} />
        </section>
      )}
    </>
  );
}
