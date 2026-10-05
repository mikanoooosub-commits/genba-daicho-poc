import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { Building, BuildingOverview, CaseOverview, InvoiceLedgerRow, Job, Unit } from "@/lib/types";
import { caseOverviewRowSchema } from "@/lib/validation/case";
import {
  buildingFilterSchema,
  buildingOverviewRowSchema,
  buildingRowSchema,
  buildingSearchInputSchema,
  unitRowSchema,
  type BuildingFilter,
} from "@/lib/validation/building";
import { invoiceLedgerRowSchema, parseOrThrow } from "@/lib/validation/invoice";
import { jobRowSchema } from "@/lib/validation/site";

// 物件・部屋の読み取り関数群(サーバーコンポーネントから呼ぶ。"use server" は付けない)。
// `select *` は使わない。Supabase から読んだ値は zod で検証してから返す(`as` は使わない)。
// 一覧は building_overview ビュー(公開契約)だけを読む。

const OVERVIEW_COLUMNS =
  "building_id, name, kind, address, memo, default_client_id, default_client_name, unit_count, job_count, last_job_date";
const BUILDING_COLUMNS =
  "id, name, kind, address, lat, lng, geo_source, default_client_id, memo, is_deleted, created_at, updated_at";
const UNIT_COLUMNS = "id, building_id, room_no, legacy_site_id, memo, is_deleted, created_at, updated_at";
const JOB_COLUMNS =
  "id, site_id, user_id, job_date, work_type, content, assignee_name, photo_urls, rating, memo, is_deleted, created_at, updated_at";
const INVOICE_LEDGER_COLUMNS =
  "invoice_id, site_id, building_name, client_id, client_name, client_type, lead_source, amount, format_pattern, issue_date, issue_month, paid_amount, payment_status";

const CASE_OVERVIEW_COLUMNS =
  "case_id, case_no, building_id, building_name, unit_id, room_no, client_id, client_name, lead_source, work_kind, received_on, request_summary, status, display_status, job_count, last_job_date, invoice_count, invoiced_total, paid_total, unpaid_total, needs_invoice, is_migrated, site_id, created_at";

const SEARCH_LIMIT = 200;

/** URL のクエリ(信用しない値)を絞り込み条件にする。不正な項目は無視し、正しい項目だけ使う */
export function parseBuildingFilter(raw: { q?: string; kind?: string; client?: string }): BuildingFilter {
  const filter: BuildingFilter = {};
  const q = buildingFilterSchema.shape.q.safeParse(raw.q?.trim() || undefined);
  if (q.success && q.data) filter.q = q.data;
  const kind = buildingFilterSchema.shape.kind.safeParse(raw.kind || undefined);
  if (kind.success && kind.data) filter.kind = kind.data;
  const client = buildingFilterSchema.shape.client.safeParse(raw.client || undefined);
  if (client.success && client.data) filter.client = client.data;
  return filter;
}

/**
 * 検索語に合う物件の id を返す(物件名・住所・メモ・部屋番号の部分一致)。
 * 列ごとに .ilike を引数として渡し(文字列連結の .or() は使わない)、id で重複を除く。
 * 検索語が不正(51字以上など)なら空配列を返す。
 */
async function findBuildingIdsByText(rawQuery: string): Promise<string[]> {
  const parsed = buildingSearchInputSchema.safeParse(rawQuery);
  if (!parsed.success) return [];
  const pattern = `%${parsed.data}%`;
  const supabase = await createClient();

  const [byName, byAddress, byMemo, byRoom] = await Promise.all([
    supabase.from("building_overview").select("building_id").ilike("name", pattern).limit(SEARCH_LIMIT),
    supabase.from("building_overview").select("building_id").ilike("address", pattern).limit(SEARCH_LIMIT),
    supabase.from("building_overview").select("building_id").ilike("memo", pattern).limit(SEARCH_LIMIT),
    supabase
      .from("units")
      .select("building_id")
      .eq("is_deleted", false)
      .ilike("room_no", pattern)
      .limit(SEARCH_LIMIT),
  ]);

  const ids = new Set<string>();
  const idRow = z.object({ building_id: z.string().uuid() });
  for (const res of [byName, byAddress, byMemo, byRoom]) {
    if (res.error) throw res.error;
    for (const row of res.data ?? []) ids.add(idRow.parse(row).building_id);
  }
  return [...ids];
}

/** 検索語が使えない形(51字以上など)のときの案内。使える形なら null */
export function searchTermProblem(q: string | undefined): string | null {
  if (!q) return null;
  const parsed = buildingSearchInputSchema.safeParse(q);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "検索語を確認してください");
}

export const BUILDING_SORTS = ["name", "last_job"] as const;
export type BuildingSort = (typeof BUILDING_SORTS)[number];

/** URL のクエリの sort を検証する。不正なら名前順 */
export function parseBuildingSort(raw: string | undefined): BuildingSort {
  const parsed = z.enum(BUILDING_SORTS).safeParse(raw);
  return parsed.success ? parsed.data : "name";
}

/** 物件の一覧(未削除)。名前順、または最後の施工が新しい順。絞り込みはサーバー側で行う */
export async function getBuildingOverviews(
  filter: BuildingFilter = {},
  sort: BuildingSort = "name"
): Promise<BuildingOverview[]> {
  const supabase = await createClient();
  const base = supabase.from("building_overview").select(OVERVIEW_COLUMNS);
  let query =
    sort === "last_job"
      ? base.order("last_job_date", { ascending: false, nullsFirst: false }).order("name")
      : base.order("name");
  if (filter.kind) query = query.eq("kind", filter.kind);
  if (filter.client) query = query.eq("default_client_id", filter.client);
  if (filter.q) {
    const ids = await findBuildingIdsByText(filter.q);
    if (ids.length === 0) return [];
    query = query.in("building_id", ids);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => buildingOverviewRowSchema.parse(row));
}

/** 絞り込みの前の全件数(「10 件 / 全 48 件」の分母) */
export async function countBuildings(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("building_overview")
    .select("building_id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function getBuildingById(id: string): Promise<Building | null> {
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buildings")
    .select(BUILDING_COLUMNS)
    .eq("id", parsedId.data)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw error;
  return data ? buildingRowSchema.parse(data) : null;
}

export async function getUnitsByBuilding(buildingId: string): Promise<Unit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .select(UNIT_COLUMNS)
    .eq("building_id", buildingId)
    .eq("is_deleted", false);
  if (error) throw error;
  return (data ?? [])
    .map((row) => unitRowSchema.parse(row))
    .sort((a, b) => (a.room_no ?? "").localeCompare(b.room_no ?? "", "ja", { numeric: true }));
}

export type CaseHistory = {
  kase: CaseOverview;
  jobs: Job[];
  invoices: InvoiceLedgerRow[];
};

/** 部屋ごとの履歴。unit が null の段は「物件全体・共用部」(部屋を指さない案件、取り消した部屋の案件) */
export type UnitHistory = {
  unit: Unit | null;
  cases: CaseHistory[];
};

/**
 * 物件の部屋ごとの履歴(WO-011 段階2)。案件(case_overview)を部屋ごとに並べ、
 * それぞれに施工と請求をぶら下げる。施工・請求は案件の sites 行(case.site_id)で結びつく
 * (v1 から移した案件も、新しく登録した案件も同じ道。D87 案A)。
 * 部屋を指さない案件、または取り消した部屋の案件は、末尾の「物件全体・共用部」の段にまとめる。
 */
export async function getUnitHistories(buildingId: string, units: Unit[]): Promise<UnitHistory[]> {
  const supabase = await createClient();
  const casesRes = await supabase
    .from("case_overview")
    .select(CASE_OVERVIEW_COLUMNS)
    .eq("building_id", buildingId)
    .order("received_on", { ascending: false })
    .order("case_no", { ascending: false });
  if (casesRes.error) throw casesRes.error;
  const cases = (casesRes.data ?? []).map((row) => caseOverviewRowSchema.parse(row));

  const siteIds = cases.map((c) => c.site_id);
  let jobs: Job[] = [];
  let invoices: InvoiceLedgerRow[] = [];
  if (siteIds.length > 0) {
    const [jobsRes, invoicesRes] = await Promise.all([
      supabase
        .from("jobs")
        .select(JOB_COLUMNS)
        .in("site_id", siteIds)
        .eq("is_deleted", false)
        .order("job_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("invoice_ledger")
        .select(INVOICE_LEDGER_COLUMNS)
        .in("site_id", siteIds)
        .order("issue_date", { ascending: false, nullsFirst: false }),
    ]);
    if (jobsRes.error) throw jobsRes.error;
    if (invoicesRes.error) throw invoicesRes.error;
    jobs = (jobsRes.data ?? []).map((row) => jobRowSchema.parse(row));
    invoices = parseOrThrow(z.array(invoiceLedgerRowSchema), invoicesRes.data ?? [], "invoice_ledger");
  }

  const toHistory = (kase: CaseOverview): CaseHistory => ({
    kase,
    jobs: jobs.filter((j) => j.site_id === kase.site_id),
    invoices: invoices.filter((i) => i.site_id === kase.site_id),
  });

  const unitIds = new Set(units.map((u) => u.id));
  const result: UnitHistory[] = units.map((unit) => ({
    unit,
    cases: cases.filter((c) => c.unit_id === unit.id).map(toHistory),
  }));
  const leftovers = cases.filter((c) => c.unit_id === null || !unitIds.has(c.unit_id));
  // 部屋の無い物件(戸建てなど)は、案件がある、または部屋が1つも無いときだけ「物件全体」の段を出す
  const hasWholeRow = units.some((u) => u.room_no === null);
  if (leftovers.length > 0 || (units.length === 0 && !hasWholeRow)) {
    result.push({ unit: null, cases: leftovers.map(toHistory) });
  }
  return result;
}

export type SimilarBuilding = { id: string; name: string; address: string | null };

/** 登録の前に「名前が似ている物件」を出す(同じ建物を2回登録しないため。一意にはしない) */
export async function findSimilarBuildings(name: string): Promise<SimilarBuilding[]> {
  const parsed = buildingSearchInputSchema.safeParse(name);
  if (!parsed.success) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buildings")
    .select("id, name, address")
    .eq("is_deleted", false)
    .ilike("name", `%${parsed.data}%`)
    .order("name")
    .limit(5);
  if (error) throw error;
  const row = z.object({ id: z.string().uuid(), name: z.string(), address: z.string().nullable() });
  return (data ?? []).map((r) => row.parse(r));
}

/** 取り消した物件(論理削除済み)。「元に戻す」の一覧に使う。新しく取り消した順 */
export async function getDeletedBuildings(): Promise<Building[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("buildings")
    .select(BUILDING_COLUMNS)
    .eq("is_deleted", true)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => buildingRowSchema.parse(row));
}

/** 物件の取り消した部屋(論理削除済み)。「元に戻す」に使う */
export async function getDeletedUnits(buildingId: string): Promise<Unit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .select(UNIT_COLUMNS)
    .eq("building_id", buildingId)
    .eq("is_deleted", true);
  if (error) throw error;
  return (data ?? []).map((row) => unitRowSchema.parse(row));
}
