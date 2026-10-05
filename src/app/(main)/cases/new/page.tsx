import Link from "next/link";
import { z } from "zod";

import { CaseQuickForm } from "@/components/cases/case-quick-form";
import { getCaseFormOptions } from "@/lib/data/queries-cases";
import { getClients } from "@/lib/data/queries-sites";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ building?: string | string[]; unit?: string | string[] }>;

function firstUuid(v: string | string[] | undefined): string | undefined {
  const parsed = z.string().uuid().safeParse(Array.isArray(v) ? v[0] : v);
  return parsed.success ? parsed.data : undefined;
}

// 案件の登録(現場でスマホ1分。docs/SPEC-v2.md §5.6・見本 quick-entry.html の A)。
// 物件の画面の「この部屋で案件を登録」から来たときは、?building=&unit= で物件と部屋が入っている。
export default async function NewCasePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [options, clients] = await Promise.all([getCaseFormOptions(), getClients()]);

  const initialBuildingId = firstUuid(sp.building);
  const initialUnitId = firstUuid(sp.unit);
  // 物件の候補に無い id(取り消した物件など)は使わない
  const buildingOk = initialBuildingId && options.buildings.some((b) => b.id === initialBuildingId);
  const unitOk = buildingOk && initialUnitId && options.units.some((u) => u.id === initialUnitId && u.building_id === initialBuildingId);

  return (
    <>
      <p className="breadcrumb">
        <Link href="/cases">案件</Link> › 案件を登録
      </p>
      <div className="page-head">
        <div>
          <h1>案件を登録</h1>
          <p className="sub">選ぶだけで済む形です。必須は物件と発注元だけです。</p>
        </div>
      </div>
      <CaseQuickForm
        buildings={options.buildings}
        units={options.units}
        clients={clients}
        recentBuildingIds={options.recentBuildingIds}
        initialBuildingId={buildingOk ? initialBuildingId : undefined}
        initialUnitId={unitOk ? initialUnitId : undefined}
      />
    </>
  );
}
