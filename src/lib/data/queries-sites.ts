import { createClient } from "@/lib/supabase/server";
import {
  clientRowSchema,
  siteWithClientRowSchema,
  jobRowSchema,
  siteStatusRowSchema,
  latestJobRowSchema,
  siteSearchInputSchema,
  type LatestJob,
  type SiteWithClientRow,
} from "@/lib/validation/site";
import type { Client, Job, SiteStatus } from "@/lib/types";

// サーバーコンポーネントから呼ぶ読み取り関数群（"use server" は付けない。既存 queries.ts と同じ方針）。
// 実装Aの担当範囲（発注元・現場・施工）のみ。請求・入金は queries-ledger.ts（実装B）を見る。
//
// 共通CLAUDE.md方針:「Supabaseから読んだ値は zod スキーマで検証してから使う（`as`によるキャストはしない）」。
// そのため各関数は select 直後の生データを *RowSchema.parse() に通してから返す。

export type SiteWithClient = SiteWithClientRow;

const CLIENT_COLUMNS = "id, name, type, format_memo, is_deleted, created_at, updated_at";
const SITE_COLUMNS = `id, client_id, building_name, room_no, address_memo, lat, lng, lead_source, is_deleted, created_at, updated_at, client:clients(${CLIENT_COLUMNS})`;
const JOB_COLUMNS =
  "id, site_id, user_id, job_date, work_type, content, assignee_name, photo_urls, rating, memo, is_deleted, created_at, updated_at";
const LATEST_JOB_COLUMNS = "site_id, job_date, work_type, content";
const SITE_STATUS_COLUMNS = "site_id, latest_job_date, latest_rating, total_invoiced, total_paid, status";

export async function getClients(includeDeleted = false): Promise<Client[]> {
  const supabase = await createClient();
  let query = supabase.from("clients").select(CLIENT_COLUMNS).order("name");
  if (!includeDeleted) query = query.eq("is_deleted", false);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => clientRowSchema.parse(row));
}

export async function getSites(includeDeleted = false): Promise<SiteWithClient[]> {
  const supabase = await createClient();
  let query = supabase
    .from("sites")
    .select(SITE_COLUMNS)
    .order("created_at", { ascending: false });
  if (!includeDeleted) query = query.eq("is_deleted", false);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => siteWithClientRowSchema.parse(row));
}

export async function getSiteById(id: string): Promise<SiteWithClient | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select(SITE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? siteWithClientRowSchema.parse(data) : null;
}

export async function getSiteStatuses(): Promise<SiteStatus[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("site_status").select(SITE_STATUS_COLUMNS);
  if (error) throw error;
  return (data ?? []).map((row) => siteStatusRowSchema.parse(row));
}

export type JobFilters = { includeDeleted?: boolean };

export async function getJobsBySite(siteId: string, filters: JobFilters = {}): Promise<Job[]> {
  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select(JOB_COLUMNS)
    .eq("site_id", siteId)
    .order("job_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (!filters.includeDeleted) query = query.eq("is_deleted", false);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => jobRowSchema.parse(row));
}

/**
 * 現場ごとの「前回施工」(未削除の施工のうち job_date・created_at が最新の1件)。
 * site_status ビューは工種・内容を持たない(スキーマは変えない方針)ため jobs から取る。
 * 全件取得してサイトごとに先頭を採る: PoC の件数前提。件数が増えたら要見直し。
 * siteIds を渡したときはその現場だけに絞る。
 */
export async function getLatestJobsBySite(siteIds?: string[]): Promise<Record<string, LatestJob>> {
  if (siteIds && siteIds.length === 0) return {};
  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select(LATEST_JOB_COLUMNS)
    .eq("is_deleted", false)
    .order("job_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (siteIds) query = query.in("site_id", siteIds);
  const { data, error } = await query;
  if (error) throw error;
  const latest: Record<string, LatestJob> = {};
  for (const row of data ?? []) {
    const job = latestJobRowSchema.parse(row);
    if (!(job.site_id in latest)) latest[job.site_id] = job;
  }
  return latest;
}

const SEARCH_LIMIT = 30;
const SEARCH_TARGET_COLUMNS = ["building_name", "address_memo", "room_no"] as const;

/**
 * 建物名・住所メモ・部屋番号の部分一致で現場を探す(未削除のみ・最大30件)。
 * 列ごとに .ilike を引数として渡し(文字列連結の .or() は使わない)、id で重複を除く。
 * 入力は zod で検証し、不正(空・長すぎ)なら空配列を返す。
 */
export async function searchSites(rawQuery: string): Promise<SiteWithClient[]> {
  const parsed = siteSearchInputSchema.safeParse(rawQuery);
  if (!parsed.success) return [];
  const pattern = `%${parsed.data}%`;
  const supabase = await createClient();
  const results = await Promise.all(
    SEARCH_TARGET_COLUMNS.map((column) =>
      supabase
        .from("sites")
        .select(SITE_COLUMNS)
        .eq("is_deleted", false)
        .ilike(column, pattern)
        .order("building_name")
        .order("room_no")
        .limit(SEARCH_LIMIT)
    )
  );
  const byId = new Map<string, SiteWithClient>();
  for (const { data, error } of results) {
    if (error) throw error;
    for (const row of data ?? []) {
      const site = siteWithClientRowSchema.parse(row);
      if (!byId.has(site.id)) byId.set(site.id, site);
    }
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        a.building_name.localeCompare(b.building_name, "ja") ||
        (a.room_no ?? "").localeCompare(b.room_no ?? "", "ja", { numeric: true })
    )
    .slice(0, SEARCH_LIMIT);
}

/**
 * 同じ建物(building_name 完全一致・未削除・自分を除く)の他の現場。
 * 建物名が空(trim後)なら問い合わせない(空文字の一致で無関係な現場が並ぶのを防ぐ: PM指示)。
 */
export async function getSiblingSites(siteId: string, buildingName: string): Promise<SiteWithClient[]> {
  if (!buildingName.trim()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select(SITE_COLUMNS)
    .eq("building_name", buildingName)
    .eq("is_deleted", false)
    .neq("id", siteId)
    .order("room_no");
  if (error) throw error;
  return (data ?? [])
    .map((row) => siteWithClientRowSchema.parse(row))
    .sort((a, b) => (a.room_no ?? "").localeCompare(b.room_no ?? "", "ja", { numeric: true }));
}

/** 発注元に紐づく現場（未削除）の件数。削除ガードに使う */
export async function countActiveSitesForClient(clientId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("sites")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("is_deleted", false);
  if (error) throw error;
  return count ?? 0;
}
