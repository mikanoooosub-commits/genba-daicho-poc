import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/estimates/print-button";
import { getBuildingById } from "@/lib/data/queries-buildings";
import { getCaseById, getCaseOverviewById } from "@/lib/data/queries-cases";
import { getBusinessProfile, getEstimateById, getEstimateItems } from "@/lib/data/queries-estimates";
import { getClients } from "@/lib/data/queries-sites";
import { formatSignedYen, formatYen } from "@/lib/format";

export const dynamic = "force-dynamic";

/** "2026-10-03" → "2026年10月3日" */
function longDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return y && m && day ? `${y}年${m}月${day}日` : d;
}

function qty(n: number): string {
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

/** 表の中の金額(¥ を付けない。マイナスは −) */
function plain(n: number): string {
  return formatSignedYen(n).replace("¥", "");
}

// 見積書(A4 縦1枚)。ブラウザの印刷で、この1枚だけが出る(PDF のライブラリは使わない・D94-8)。
// 明細が多いときは、表の見出しを各ページに繰り返し、行の途中では改ページしない。
// 事業者情報(屋号・住所・電話・登録番号・振込先)は business_profile から。研修では架空の値。
export default async function EstimatePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const estimate = await getEstimateById(id);
  if (!estimate) notFound();
  const kase = await getCaseById(estimate.case_id);
  if (!kase) notFound();

  const [items, profile, clients, overview, building] = await Promise.all([
    getEstimateItems(estimate.id),
    getBusinessProfile(),
    getClients(true),
    getCaseOverviewById(kase.id),
    getBuildingById(kase.building_id),
  ]);
  const client = clients.find((c) => c.id === kase.client_id);
  const buildingName = overview?.building_name ?? building?.name ?? "";
  const place = overview?.room_no ? `${buildingName} ${overview.room_no}` : buildingName;
  const subject = [place, kase.request_summary].filter(Boolean).join(" ");

  return (
    <>
      <div
        className="print-hide"
        style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", flexWrap: "wrap", marginBottom: "var(--sp-4)" }}
      >
        <Link className="btn btn-secondary" href={`/estimates/${estimate.id}`}>
          見積に戻る
        </Link>
        <PrintButton />
        <span className="hint">
          ブラウザの印刷で、この1枚だけが出ます。PDF にするときは、印刷の画面で「PDF に保存」を選びます。
        </span>
      </div>

      <div className="paper-scroll">
        <article className="paper" aria-label="見積書">
          <h1>御見積書</h1>
          {estimate.status === "下書き" && <p className="draft-stamp">下書き(未提出)</p>}
          <div className="top">
            <div>
              <div className="to">
                {client?.name ?? "(宛先不明)"}
                <small>御中</small>
              </div>
              {subject && <p>件名: {subject}</p>}
              {estimate.valid_until && <p>有効期限: {longDate(estimate.valid_until)}</p>}
              <div className="sum-box">
                <span>御見積金額(税込)</span>
                <b>{formatYen(estimate.total_yen)}</b>
              </div>
            </div>
            <div>
              <p className="meta">
                見積番号 {estimate.estimate_no}(第{estimate.version}版)
                <br />
                発行日 {estimate.issue_date ? longDate(estimate.issue_date) : "(未提出)"}
              </p>
              {profile && (
                <div className="from">
                  <b>{profile.shop_name}</b>
                  {profile.address && (
                    <>
                      <br />
                      {profile.address}
                    </>
                  )}
                  {profile.phone && (
                    <>
                      <br />
                      電話 {profile.phone}
                    </>
                  )}
                  {profile.invoice_reg_no && (
                    <>
                      <br />
                      登録番号 {profile.invoice_reg_no}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th style={{ width: "16mm" }}>区分</th>
                <th>内容</th>
                <th style={{ width: "16mm" }}>数量</th>
                <th style={{ width: "12mm" }}>単位</th>
                <th style={{ width: "22mm" }}>単価</th>
                <th style={{ width: "24mm" }}>金額</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.category}</td>
                  <td>{it.description}</td>
                  <td className="n">{qty(it.quantity)}</td>
                  <td>{it.unit ?? ""}</td>
                  <td className="n">{plain(it.unit_price_yen)}</td>
                  <td className="n">{plain(it.amount_yen)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="tot">
            <tbody>
              <tr>
                <td>小計(税抜)</td>
                <td className="n">{plain(estimate.subtotal_yen)}</td>
              </tr>
              <tr>
                <td>消費税({estimate.tax_rate_pct}%)</td>
                <td className="n">{plain(estimate.tax_yen)}</td>
              </tr>
              <tr>
                <td>合計(税込)</td>
                <td className="n">{formatYen(estimate.total_yen)}</td>
              </tr>
            </tbody>
          </table>

          <div className="note">備考: {estimate.note ?? ""}</div>
          {profile?.bank_info && <p className="bank">お振込先: {profile.bank_info}</p>}
        </article>
      </div>
    </>
  );
}
