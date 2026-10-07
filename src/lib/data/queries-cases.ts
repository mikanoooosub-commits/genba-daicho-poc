import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { Case, CaseDisplayStatus, CaseOverview } from "@/lib/types";
import {
  CASE_DISPLAY_STATUSES,
  caseBuildingOptionSchema,
  caseFilterSchema,
  caseOverviewRowSchema,
  caseRowSchema,
  caseSearchInputSchema,
  caseUnitOptionSchema,
  type CaseBuildingOption,
  type CaseFilter,
  type CaseUnitOption,
} from "@/lib/validation/case";

// 案件の読み取り関数群(サーバーコンポーネントから呼ぶ。"use server" は付けない)。
// `select *` は使わない。Supabase から読んだ値は zod で検証してから返す(`as` は使わない)。
// 一覧は case_overview ビュー(公開契約)の決まった列だけを読む。

const OVERVIEW_COLUMNS =
  "case_id, case_no, building_id, building_name, unit_id, room_no, client_id, client_name, lead_source, work_kind, received_on, request_summary, status, display_status, job_count, last_job_date, invoice_count, invoiced_total, paid_total, unpaid_total, needs_invoice, is_migrated, site_id, created_at";
const CASE_COLUMNS =
  "id, case_no, building_id, unit_id, site_id, client_id, lead_source, work_kind, received_on, request_summary, status, lost_reason, memo, is_deleted, created_at, updated_at";

const SEARCH_LIMIT = 300;

/** URL のクエリ(信用しない値)を絞り込み条件にする。不正な項目は無視し、正しい項目だけ使う */
export function parseCaseFilter(raw: { q?: string; status?: string; client?: string; attention?: string }): CaseFilter {
  const filter: CaseFilter = {};
  const q = caseFilterSchema.shape.q.safeParse(raw.q?.trim() || undefined);
  if (q.success && q.data) filter.q = q.data;
  const status = caseFilterSchema.shape.status.safeParse(raw.status || undefined);
  if (status.success && status.data) filter.status = status.data;
  const client = caseFilterSchema.shape.client.safeParse(raw.client || undefined);
  if (client.success && client.data) filter.client = client.data;
  const attention = caseFilterSchema.shape.attention.safeParse(raw.attention || undefined);
  if (attention.success && attention.data) filter.attention = attention.data;
  return filter;
}

/** 検索語が使えない形(51字以上など)のときの案内。使える形なら null */
export function caseSearchProblem(q: string | undefined): string | null {
  if (!q) return null;
  const parsed = caseSearchInputSchema.safeParse(q);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "検索語を確認してください");
}

/** 検索語に合う案件の id(案件番号・物件名・部屋番号・依頼の内容の部分一致)。列ごとに .ilike を渡す */
async function findCaseIdsByText(rawQuery: string): Promise<string[]> {
  const parsed = caseSearchInputSchema.safeParse(rawQuery);
  if (!parsed.success) return [];
  const pattern = `%${parsed.data}%`;
  const supabase = await createClient();
  const results = await Promise.all(
    ["case_no", "building_name", "room_no", "request_summary"].map((col) =>
      supabase.from("case_overview").select("case_id").ilike(col, pattern).limit(SEARCH_LIMIT)
    )
  );
  const ids = new Set<string>();
  const idRow = z.object({ case_id: z.string().uuid() });
  for (const res of results) {
    if (res.error) throw res.error;
    for (const row of res.data ?? []) ids.add(idRow.parse(row).case_id);
  }
  return [...ids];
}

/** 案件の一覧(取り消していないもの)。受付日の新しい順。絞り込みはサーバー側で行う */
export async function getCaseOverviews(filter: CaseFilter = {}): Promise<CaseOverview[]> {
  const supabase = await createClient();
  let query = supabase
    .from("case_overview")
    .select(OVERVIEW_COLUMNS)
    .order("received_on", { ascending: false })
    .order("case_no", { ascending: false });
  if (filter.status) query = query.eq("display_status", filter.status);
  if (filter.client) query = query.eq("client_id", filter.client);
  if (filter.attention === "needs_invoice") query = query.eq("needs_invoice", true);
  if (filter.q) {
    const ids = await findCaseIdsByText(filter.q);
    if (ids.length === 0) return [];
    query = query.in("case_id", ids);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => caseOverviewRowSchema.parse(row));
}

export type CaseCounts = {
  total: number;
  needsInvoice: number;
  byStatus: Record<CaseDisplayStatus, number>;
  /** 入金待ち(請求済の案件の未入金の合計・税込)と、その件数。一覧の頭の大きな数字に使う */
  receivable: { amount: number; count: number };
  /** 入金済の案件の入金の合計 */
  paidAmount: number;
  /** 請求した金額の合計(請求のある案件) */
  invoicedAmount: number;
};

/** 絞り込みの前の件数(状態ごと・「請求が未作成」)。一覧の上の「要対応」と状態の件数に使う */
export async function getCaseCounts(): Promise<CaseCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("case_overview")
    .select("display_status, needs_invoice, invoiced_total, paid_total, unpaid_total");
  if (error) throw error;
  const row = z.object({
    display_status: z.enum(CASE_DISPLAY_STATUSES),
    needs_invoice: z.boolean(),
    invoiced_total: z.coerce.number(),
    paid_total: z.coerce.number(),
    unpaid_total: z.coerce.number(),
  });
  const byStatus: Record<CaseDisplayStatus, number> = {
    依頼: 0,
    見積中: 0,
    受注: 0,
    施工中: 0,
    完了: 0,
    請求済: 0,
    入金済: 0,
    失注: 0,
  };
  let needsInvoice = 0;
  let receivableAmount = 0;
  let receivableCount = 0;
  let paidAmount = 0;
  let invoicedAmount = 0;
  const rows = (data ?? []).map((r) => row.parse(r));
  for (const r of rows) {
    byStatus[r.display_status] += 1;
    if (r.needs_invoice) needsInvoice += 1;
    invoicedAmount += r.invoiced_total;
    paidAmount += r.paid_total;
    if (r.display_status === "請求済") {
      receivableAmount += r.unpaid_total;
      receivableCount += 1;
    }
  }
  return {
    total: rows.length,
    needsInvoice,
    byStatus,
    receivable: { amount: receivableAmount, count: receivableCount },
    paidAmount,
    invoicedAmount,
  };
}

/** 案件1件(取り消した案件も返す。画面で「元に戻す」を出すため) */
export async function getCaseById(id: string): Promise<Case | null> {
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cases").select(CASE_COLUMNS).eq("id", parsedId.data).maybeSingle();
  if (error) throw error;
  return data ? caseRowSchema.parse(data) : null;
}

/** 案件の集計つきの1行(取り消した案件は出ない) */
export async function getCaseOverviewById(id: string): Promise<CaseOverview | null> {
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("case_overview")
    .select(OVERVIEW_COLUMNS)
    .eq("case_id", parsedId.data)
    .maybeSingle();
  if (error) throw error;
  return data ? caseOverviewRowSchema.parse(data) : null;
}

/** 現場(sites 行)に結びついた案件の id。v1 の現場詳細・施工/請求の登録が、案件に結びつけるために使う */
export async function findCaseIdBySite(siteId: string): Promise<string | null> {
  const parsedId = z.string().uuid().safeParse(siteId);
  if (!parsedId.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cases").select("id").eq("site_id", parsedId.data).maybeSingle();
  if (error) throw error;
  return data ? z.object({ id: z.string().uuid() }).parse(data).id : null;
}

/** 取り消した案件。「元に戻す」の一覧に使う。新しく取り消した順 */
export async function getDeletedCases(): Promise<{ id: string; case_no: string; building_name: string; room_no: string | null }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cases")
    .select("id, case_no, building:buildings(name), unit:units(room_no)")
    .eq("is_deleted", true)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const row = z.object({
    id: z.string().uuid(),
    case_no: z.string(),
    building: z.object({ name: z.string() }).nullable(),
    unit: z.object({ room_no: z.string().nullable() }).nullable(),
  });
  return (data ?? []).map((r) => {
    const p = row.parse(r);
    return { id: p.id, case_no: p.case_no, building_name: p.building?.name ?? "(物件不明)", room_no: p.unit?.room_no ?? null };
  });
}

/** 案件の登録の入口に出す、物件と部屋の候補(取り消していないもの) */
export async function getCaseFormOptions(): Promise<{
  buildings: CaseBuildingOption[];
  units: CaseUnitOption[];
  recentBuildingIds: string[];
}> {
  const supabase = await createClient();
  const [buildingsRes, unitsRes, recentRes] = await Promise.all([
    supabase
      .from("buildings")
      .select("id, name, kind, default_client_id")
      .eq("is_deleted", false)
      .order("name")
      .limit(500),
    supabase.from("units").select("id, building_id, room_no").eq("is_deleted", false).limit(2000),
    supabase
      .from("case_overview")
      .select("building_id")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (buildingsRes.error) throw buildingsRes.error;
  if (unitsRes.error) throw unitsRes.error;
  if (recentRes.error) throw recentRes.error;

  const buildings = (buildingsRes.data ?? []).map((r) => caseBuildingOptionSchema.parse(r));
  const units = (unitsRes.data ?? [])
    .map((r) => caseUnitOptionSchema.parse(r))
    .sort((a, b) => (a.room_no ?? "").localeCompare(b.room_no ?? "", "ja", { numeric: true }));
  const recentRow = z.object({ building_id: z.string().uuid() });
  const recentBuildingIds: string[] = [];
  for (const r of recentRes.data ?? []) {
    const id = recentRow.parse(r).building_id;
    if (!recentBuildingIds.includes(id)) recentBuildingIds.push(id);
    if (recentBuildingIds.length >= 3) break;
  }
  return { buildings, units, recentBuildingIds };
}
