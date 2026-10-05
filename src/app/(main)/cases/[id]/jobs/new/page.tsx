import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CaseJobQuickForm } from "@/components/cases/case-job-quick-form";
import { getCaseById, getCaseOverviewById } from "@/lib/data/queries-cases";

export const dynamic = "force-dynamic";

// 施工の記録(現場でスマホ1分。docs/SPEC-v2.md §5.6・見本 quick-entry.html の B)。
// 案件の画面から開くので、物件・部屋・発注元はもう入っている。取り消し済みの案件には記録できない。
export default async function NewCaseJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kase = await getCaseById(id);
  if (!kase) notFound();
  if (kase.is_deleted) redirect(`/cases/${kase.id}`);

  const overview = await getCaseOverviewById(kase.id);
  const placeLabel = overview
    ? overview.room_no
      ? `${overview.building_name} ${overview.room_no}`
      : overview.building_name
    : kase.case_no;

  return (
    <>
      <p className="breadcrumb">
        <Link href="/cases">案件</Link> › <Link href={`/cases/${kase.id}`}>{kase.case_no}</Link> › 施工を記録
      </p>
      <div className="page-head">
        <div>
          <h1>施工を記録</h1>
          <p className="sub">選ぶだけで済む形です。必須は工種だけです。</p>
        </div>
      </div>
      <CaseJobQuickForm
        caseId={kase.id}
        siteId={kase.site_id}
        placeLabel={placeLabel}
        caseNo={kase.case_no}
        clientName={overview?.client_name ?? ""}
      />
    </>
  );
}
