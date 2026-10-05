import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CaseEditForm } from "@/components/cases/case-edit-form";
import { getBuildingById } from "@/lib/data/queries-buildings";
import { getCaseById, getCaseOverviewById } from "@/lib/data/queries-cases";
import { getClients } from "@/lib/data/queries-sites";

export const dynamic = "force-dynamic";

// 案件の編集(依頼の内容・種類・受付日・集客経路・発注元の直し)。取り消し済みの案件は直せない。
export default async function EditCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kase = await getCaseById(id);
  if (!kase) notFound();
  if (kase.is_deleted) redirect(`/cases/${kase.id}`);

  const [overview, building, clients] = await Promise.all([
    getCaseOverviewById(kase.id),
    getBuildingById(kase.building_id),
    getClients(),
  ]);
  const buildingName = overview?.building_name ?? building?.name ?? "(物件不明)";
  const placeLabel = overview?.room_no ? `${buildingName} ${overview.room_no}` : buildingName;

  return (
    <>
      <p className="breadcrumb">
        <Link href="/cases">案件</Link> › <Link href={`/cases/${kase.id}`}>{kase.case_no}</Link> › 編集
      </p>
      <div className="page-head">
        <div>
          <h1>案件を直す</h1>
          <p className="sub">打ち間違いを直します。変更は履歴に残ります。</p>
        </div>
      </div>
      <CaseEditForm
        caseId={kase.id}
        caseNo={kase.case_no}
        placeLabel={placeLabel}
        clients={clients}
        initial={{
          clientId: kase.client_id,
          workKind: kase.work_kind,
          leadSource: kase.lead_source,
          receivedOn: kase.received_on,
          requestSummary: kase.request_summary ?? "",
        }}
      />
    </>
  );
}
