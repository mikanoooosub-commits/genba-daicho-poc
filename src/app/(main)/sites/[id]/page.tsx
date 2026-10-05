import { notFound, redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { SiteDetailView } from "@/components/sites/site-detail-view";
import { findCaseIdBySite } from "@/lib/data/queries-cases";
import {
  getClients,
  getJobsBySite,
  getLatestJobsBySite,
  getSiblingSites,
  getSiteById,
} from "@/lib/data/queries-sites";
// 請求・入金は実装Bの自己完結コンポーネント(Server Component)。実装A(このページ)は
// クエリを書かず、生成済みの要素を SiteDetailView(Client Component)へ children として渡す
// (Server Component を Client Component の props として渡す、Next.js の合成パターン)。
// SPEC.md §11: 実装Bが担当するファイル(queries-ledger.ts 等)には触れない。
import { SiteInvoicesPanel } from "@/components/ledger/site-invoices-panel";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ deleted?: string }>;

export default async function SiteDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;

  // 段階2(D87 案A): 全部の現場は案件に結びついている。v1 の現場詳細は、その案件の画面に移る
  // (台帳のリンクなど、古い入口から来ても案件の画面に着く。v1 の画面は案件に結びつかない現場のためだけに残す)
  const caseId = await findCaseIdBySite(id);
  if (caseId) redirect(`/cases/${caseId}`);

  const sp = await searchParams;
  const includeDeleted = sp.deleted === "1";

  const [site, jobs, clients] = await Promise.all([
    getSiteById(id),
    getJobsBySite(id, { includeDeleted }),
    getClients(),
  ]);

  if (!site) notFound();

  // 同じ建物の他の部屋(建物名の完全一致・削除済み除く)と、それぞれの前回施工。
  // 建物名が空の現場は getSiblingSites が問い合わせずに空を返す
  const siblings = await getSiblingSites(site.id, site.building_name);
  const siblingLatestJobs = await getLatestJobsBySite(siblings.map((s) => s.id));

  return (
    <>
      <AppHeader
        title={site.building_name}
        subtitle={site.client?.name ?? "発注元未設定"}
        backHref="/buildings"
      />
      <main className="px-4 py-4">
        <SiteDetailView
          site={site}
          jobs={jobs}
          clients={clients}
          includeDeleted={includeDeleted}
          siblings={siblings}
          siblingLatestJobs={siblingLatestJobs}
        >
          <SiteInvoicesPanel siteId={site.id} buildingName={site.building_name} />
        </SiteDetailView>
      </main>
    </>
  );
}
