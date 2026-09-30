import { AppHeader } from "@/components/app-header";
import { SiteMapView } from "@/components/sites/site-map-view";
import {
  getClients,
  getLatestJobsBySite,
  getSites,
  getSiteStatuses,
  searchSites,
} from "@/lib/data/queries-sites";
import type { SiteStatus } from "@/lib/types";
import { siteSearchInputSchema } from "@/lib/validation/site";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string | string[] }>;

// P-A″ 現場を軸にした台帳（地図つき）: このPoCの①地図画面。
// 既存のチラシ配布向け地図(schools/locations/visits の pin)は、この画面からは外し
// `/list`・`/schools` へ移した(ナビからも外す。ルート自体は残す。PM決定 D38-2)。
// この置き換え自体については「PMに判断を求める点」で報告する。
// D51: 地図は補助。上部の検索(建物名・住所メモ・部屋番号)で現場を引き、前回施工へ進むのが入口(WO-006)。
export default async function MapHomePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const query = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? "";

  // 入力が不正(51字以上など)なら検索せず、zod のメッセージを案内として出す
  const parsedQuery = query ? siteSearchInputSchema.safeParse(query) : null;
  const searchNotice = parsedQuery && !parsedQuery.success ? parsedQuery.error.issues[0].message : null;

  const [clients, sites, statuses, latestJobs, matchedSites] = await Promise.all([
    getClients(),
    getSites(),
    getSiteStatuses(),
    getLatestJobsBySite(),
    query && !searchNotice ? searchSites(query) : Promise.resolve(null),
  ]);

  const statusMap: Record<string, SiteStatus> = {};
  for (const s of statuses) statusMap[s.site_id] = s;

  return (
    <>
      <AppHeader title="地図" subtitle="現場ごとの請求・入金状況" />
      <SiteMapView
        clients={clients}
        sites={sites}
        statusMap={statusMap}
        latestJobs={latestJobs}
        query={query}
        matchedSites={matchedSites}
        searchNotice={searchNotice}
      />
    </>
  );
}
