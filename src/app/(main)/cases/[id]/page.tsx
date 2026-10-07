import Link from "next/link";
import { ChevronDown, FileWarning, Pencil } from "lucide-react";
import { notFound } from "next/navigation";

import { CaseAuditLog } from "@/components/cases/case-audit";
import { SiteInvoicesPanel } from "@/components/ledger/site-invoices-panel";
import { CaseCostsSection } from "@/components/estimates/case-costs-section";
import { CaseEstimatesSection } from "@/components/estimates/case-estimates-section";
import { CaseJobsSection } from "@/components/cases/case-jobs-section";
import { CaseStatusControls, DeleteCaseButton, RestoreCaseButton } from "@/components/cases/case-controls";
import { StatusLabel, caseStatusTone } from "@/components/status-label";
import { getBuildingById } from "@/lib/data/queries-buildings";
import { getCaseById, getCaseOverviewById } from "@/lib/data/queries-cases";
import { getCaseFinancials, getCostsByCase, getEstimatesByCase } from "@/lib/data/queries-estimates";
import { getClients, getJobsBySite } from "@/lib/data/queries-sites";
import { formatDate, formatYen } from "@/lib/format";
import { CASE_DISPLAY_STATUS_ORDER } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ new?: string; job?: string }>;

// 案件の詳細(WO-011 段階2・docs/SPEC-v2.md §5)。1件の仕事を、依頼から入金まで1画面で見る。
// 施工と請求・入金は、案件の sites 行(case.site_id)に付く v1 の部品をそのまま使う(D87 案A)。
// 見積・原価は段階3、期日は段階4 で足す。
export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const kase = await getCaseById(id);
  if (!kase) notFound();

  const [overview, building, clients, jobs, estimates, costs, financials] = await Promise.all([
    getCaseOverviewById(kase.id),
    getBuildingById(kase.building_id),
    getClients(true),
    getJobsBySite(kase.site_id),
    getEstimatesByCase(kase.id),
    getCostsByCase(kase.id),
    getCaseFinancials(kase.id),
  ]);

  const client = clients.find((c) => c.id === kase.client_id);
  const roomLabel = overview?.room_no ?? null;
  const buildingName = overview?.building_name ?? building?.name ?? "(物件不明)";
  const place = roomLabel ? `${buildingName} ${roomLabel}` : buildingName;
  const displayStatus = overview?.display_status ?? kase.status;
  const isDeleted = kase.is_deleted;
  const flowIndex = CASE_DISPLAY_STATUS_ORDER.indexOf(displayStatus);

  // その状態で次にやる1つ(主のボタン)。1画面に主は1つ(D106-1)。
  // 依頼・見積中=見積を作る / 受注・施工中=施工を記録 / 完了で請求なし=請求を追加 / 請求済・入金済・失注=なし
  const hasInvoice = (overview?.invoice_count ?? 0) > 0;
  const adoptedEstimate = estimates.find((e) => e.status === "採用") ?? null;
  const primaryAction: "estimate" | "job" | "invoice" | "invoice-from-estimate" | "payment" | null = isDeleted
    ? null
    : displayStatus === "依頼" || displayStatus === "見積中"
      ? "estimate"
      : displayStatus === "受注" || displayStatus === "施工中"
        ? "job"
        : displayStatus === "完了" && !hasInvoice
          ? adoptedEstimate
            ? "invoice-from-estimate"
            : "invoice"
          : displayStatus === "請求済"
            ? "payment"
            : null;

  // 「次にやること」の帯(状態から決まる案内。新しいデータではない)。押すと、その操作のある区画へ移る
  const nextBand: { title: string; text: string; href: string; tone: "warn" | "info" | "done" } | null = isDeleted
    ? null
    : primaryAction === "estimate"
      ? { title: "見積を作る", text: "依頼を受けています。見積を作って提出します。", href: "#estimates-h", tone: "info" }
      : primaryAction === "job"
        ? { title: "施工を記録", text: "施工したら、その日のうちに記録します。", href: "#jobs-h", tone: "info" }
        : primaryAction === "invoice-from-estimate"
          ? { title: "請求を作る", text: "完了しています。採用した見積から請求を作れます。", href: "#estimates-h", tone: "warn" }
          : primaryAction === "invoice"
            ? { title: "請求を作る", text: "完了しています。請求がまだありません。", href: "#invoices-h", tone: "warn" }
            : primaryAction === "payment"
              ? { title: "入金を登録", text: "請求を出しています。入金があったら登録します。", href: "#invoices-h", tone: "info" }
              : displayStatus === "入金済"
                ? { title: "済み", text: "入金まで済んでいます。", href: "#invoices-h", tone: "done" }
                : null;

  const flow = (
    <ol className="flow" aria-label="状態の流れ">
      {CASE_DISPLAY_STATUS_ORDER.filter((s) => s !== "失注" || displayStatus === "失注").map((s) => {
        const i = CASE_DISPLAY_STATUS_ORDER.indexOf(s);
        const cls = s === displayStatus ? "now" : displayStatus !== "失注" && i < flowIndex ? "done" : undefined;
        return (
          <li key={s} className={cls} aria-current={s === displayStatus ? "step" : undefined}>
            {s}
          </li>
        );
      })}
    </ol>
  );

  return (
    <>
      <nav className="breadcrumb" aria-label="パンくず">
        <Link href="/cases">案件</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{kase.case_no}</span>
      </nav>

      {sp.new === "1" && !isDeleted && (
        <div className="toast section-gap" role="status">
          {kase.case_no} を登録しました。続けて、施工の記録や請求の登録ができます。
        </div>
      )}

      {sp.job === "1" && !isDeleted && (
        <div className="toast section-gap" role="status">
          施工を記録しました。<a href="#status-h">状態を確かめる ›</a>
        </div>
      )}

      {isDeleted && (
        <div className="notice notice-danger" role="status" style={{ marginBottom: "var(--sp-4)" }}>
          <div>
            <strong>この案件は取り消し済みです</strong>
            案件の一覧には出ません。元に戻すと、一覧に戻ります。{" "}
            <RestoreCaseButton caseId={kase.id} />
          </div>
        </div>
      )}

      <div className="page-head case-top">
        <div>
          <h1 id="case-title">{place}</h1>
          <div className="case-head">
            <StatusLabel tone={caseStatusTone(displayStatus)}>{displayStatus}</StatusLabel>
            {overview?.needs_invoice && (
              <span className="flag flag-warn">
                <FileWarning className="icon" aria-hidden="true" />
                請求が未作成
              </span>
            )}
          </div>
        </div>
        <div className="case-actions">
          {!isDeleted && (
            <Link className="btn btn-secondary" href={`/cases/${kase.id}/edit`}>
              <Pencil className="icon" aria-hidden="true" />
              編集
            </Link>
          )}
          <CaseAuditLog caseId={kase.id} clientNames={Object.fromEntries(clients.map((c) => [c.id, c.name]))} />
        </div>
      </div>

      {nextBand && (
        <a className={`next-band next-${nextBand.tone}`} href={nextBand.href}>
          <span className="lbl">次にやること</span>
          <strong>{nextBand.title}</strong>
          <span className="txt">{nextBand.text}</span>
          <ChevronDown className="icon go" aria-hidden="true" />
        </a>
      )}

      <CaseCostsSection
        caseId={kase.id}
        costs={costs}
        financials={financials}
        today={new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date())}
        disabled={isDeleted}
      />

      {!isDeleted ? (
        <CaseStatusControls
          caseId={kase.id}
          status={kase.status}
          jobCount={jobs.length}
          hasInvoice={hasInvoice}
          justRecordedJob={sp.job === "1"}
          flow={flow}
        />
      ) : (
        <section className="card card-sec" aria-labelledby="status-h">
          <div className="sec-head">
            <h2 id="status-h">状態</h2>
          </div>
          <div className="sec-body">{flow}</div>
        </section>
      )}

      <CaseEstimatesSection
        caseId={kase.id}
        estimates={estimates}
        disabled={isDeleted}
        primary={primaryAction === "estimate"}
        invoiceFromEstimateId={primaryAction === "invoice-from-estimate" ? (adoptedEstimate?.id ?? null) : null}
      />

      <CaseJobsSection caseId={kase.id} jobs={jobs} disabled={isDeleted} primary={primaryAction === "job"} />

      <SiteInvoicesPanel siteId={kase.site_id} buildingName={place} primary={primaryAction === "invoice"} primaryPayment={primaryAction === "payment"} />

      <section className="card card-pad section-gap" aria-label="案件の項目">
        <dl className="dl-grid">
          <div>
            <dt>案件番号</dt>
            <dd className="num">{kase.case_no}</dd>
          </div>
          <div>
            <dt>受付日</dt>
            <dd className="num">{formatDate(kase.received_on)}</dd>
          </div>
          <div className="wide">
            <dt>物件</dt>
            <dd>
              <Link href={`/buildings/${kase.building_id}`}>
                {buildingName}
                {roomLabel ? ` ${roomLabel}` : "(物件全体・共用部)"}
              </Link>
            </dd>
          </div>
          <div className="wide">
            <dt>発注元(請求先)</dt>
            <dd>{client?.name ?? <span className="muted">不明</span>}</dd>
          </div>
          <div>
            <dt>種類</dt>
            <dd>{kase.work_kind}</dd>
          </div>
          <div>
            <dt>集客経路</dt>
            <dd>{kase.lead_source}</dd>
          </div>
          <div className="wide">
            <dt>依頼の内容</dt>
            <dd>
              {kase.request_summary ?? <span className="muted">なし</span>}
              {overview?.is_migrated && (
                <span className="caption">旧画面から移した案件(施工と請求をまとめてあります)</span>
              )}
            </dd>
          </div>
          {kase.status === "失注" && (
            <div className="wide">
              <dt>失注の理由</dt>
              <dd>{kase.lost_reason ?? <span className="muted">なし</span>}</dd>
            </div>
          )}
          {overview && overview.invoice_count > 0 && (
            <div className="wide">
              <dt>請求・入金</dt>
              <dd className="num">
                請求 {formatYen(overview.invoiced_total)}(税込)・入金 {formatYen(overview.paid_total)}・未入金{" "}
                {formatYen(overview.unpaid_total)}
              </dd>
            </div>
          )}
        </dl>

        {!isDeleted && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--sp-4)" }}>
            <DeleteCaseButton caseId={kase.id} jobCount={jobs.length} />
          </div>
        )}
      </section>
    </>
  );
}
