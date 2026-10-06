import Link from "next/link";
import { notFound } from "next/navigation";

import { CaseStatusSuggestion } from "@/components/estimates/estimate-status-actions";
import { EstimateWorkspace } from "@/components/estimates/estimate-workspace";
import { StatusLabel, caseStatusTone, type StatusTone } from "@/components/status-label";
import { getCaseById, getCaseOverviewById } from "@/lib/data/queries-cases";
import {
  getEstimateById,
  getEstimateItems,
  getEstimateReferences,
  getEstimateVersions,
  getInvoiceIdByEstimate,
} from "@/lib/data/queries-estimates";
import { getClients } from "@/lib/data/queries-sites";
import { formatDate } from "@/lib/format";
import { CASE_DISPLAY_STATUS_ORDER, type EstimateStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ lost?: string }>;

const ESTIMATE_TONE: Record<EstimateStatus, StatusTone> = {
  下書き: "neutral",
  提出済: "info",
  採用: "good",
  不採用: "lost",
};

// 見積の画面(WO-011 段階3・docs/SPEC-v2.md §5.5)。明細の編集・合計・提出・採用・出し直し・請求を作る。
// 合計は、保存のたびに DB が計算した値を出す。提出済以降は読むだけ(DB が守る)。
export default async function EstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const includeLost = sp.lost === "1";

  const estimate = await getEstimateById(id);
  if (!estimate) notFound();
  const kase = await getCaseById(estimate.case_id);
  if (!kase) notFound();

  const [overview, clients, items, versions, invoiceId, references] = await Promise.all([
    getCaseOverviewById(kase.id),
    getClients(true),
    getEstimateItems(estimate.id),
    getEstimateVersions(estimate.estimate_no),
    getInvoiceIdByEstimate(estimate.id),
    getEstimateReferences(estimate, { includeLost }),
  ]);

  const client = clients.find((c) => c.id === kase.client_id);
  const place = overview ? (overview.room_no ? `${overview.building_name} ${overview.room_no}` : overview.building_name) : kase.case_no;
  const displayStatus = overview?.display_status ?? kase.status;
  const flowIndex = CASE_DISPLAY_STATUS_ORDER.indexOf(displayStatus);
  const isLatest = versions.length === 0 || versions[0].id === estimate.id;
  const editable = estimate.status === "下書き" && !kase.is_deleted;

  let suggestion: { status: typeof kase.status; reason: string } | null = null;
  if (!kase.is_deleted) {
    if (estimate.status === "提出済" && kase.status === "依頼") {
      suggestion = { status: "見積中", reason: "見積を提出しました。" };
    } else if (estimate.status === "採用" && (kase.status === "依頼" || kase.status === "見積中")) {
      suggestion = { status: "受注", reason: "この見積が採用されました。" };
    }
  }

  return (
    <>
      <p className="breadcrumb">
        <Link href="/cases">案件</Link> › <Link href={`/cases/${kase.id}`}>{kase.case_no} {place}</Link> › 見積
      </p>

      {kase.is_deleted && (
        <div className="notice notice-danger" role="status" style={{ marginBottom: "var(--sp-4)" }}>
          <div>
            <strong>この案件は取り消し済みです</strong>
            見積は読むだけです。案件を元に戻すと、続けられます。
          </div>
        </div>
      )}

      <div className="est-head">
        <div>
          <h1>
            見積 {estimate.estimate_no} <small>第{estimate.version}版</small>{" "}
            <StatusLabel tone={ESTIMATE_TONE[estimate.status]}>{estimate.status}</StatusLabel>
          </h1>
          <p className="case-ref">
            {place}・{client?.name ?? "発注元不明"}
            {kase.request_summary ? `・${kase.request_summary}` : ""}
            {estimate.issue_date ? `・提出日 ${formatDate(estimate.issue_date)}` : ""}
          </p>
          {versions.length > 1 && (
            <p className="case-ref">
              版:{" "}
              {versions.map((v, i) => (
                <span key={v.id}>
                  {i > 0 ? "・" : ""}
                  {v.id === estimate.id ? (
                    <strong>第{v.version}版</strong>
                  ) : (
                    <Link href={`/estimates/${v.id}`}>第{v.version}版({v.status})</Link>
                  )}
                </span>
              ))}
            </p>
          )}
        </div>
        <StatusLabel tone={caseStatusTone(displayStatus)}>案件: {displayStatus}</StatusLabel>
      </div>

      {suggestion && (
        <CaseStatusSuggestion
          caseId={kase.id}
          caseStatus={kase.status}
          suggested={suggestion.status}
          reason={suggestion.reason}
        />
      )}

      <div className="flow-wrap">
        <ol className="flow" aria-label="案件の流れ">
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
      </div>

      <EstimateWorkspace
        key={`${estimate.id}-${estimate.updated_at}`}
        estimate={estimate}
        items={items}
        editable={editable}
        clientName={client?.name ?? "発注元不明"}
        references={references}
        includeLost={includeLost}
        isLatest={isLatest}
        invoiceId={invoiceId}
      />
    </>
  );
}
