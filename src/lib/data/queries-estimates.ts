import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { BusinessProfile, CaseFinancials, Cost, Estimate, EstimateItem } from "@/lib/types";
import {
  businessProfileRowSchema,
  caseFinancialsRowSchema,
  costRowSchema,
  estimateItemRowSchema,
  estimateRowSchema,
} from "@/lib/validation/estimate";

// 見積・明細・原価・事業者情報・粗利の読み取り関数群(サーバーコンポーネントから呼ぶ。"use server" は付けない)。
// `select *` は使わない。Supabase から読んだ値は zod で検証してから返す(`as` は使わない)。
// 粗利は case_financials ビュー(公開契約)の決まった列だけを読む。

const ESTIMATE_COLUMNS =
  "id, case_id, estimate_no, version, copied_from_id, status, issue_date, valid_until, tax_rate_pct, subtotal_yen, tax_yen, total_yen, note, is_deleted, created_at, updated_at";
const ITEM_COLUMNS =
  "id, estimate_id, sort_order, category, description, quantity, unit, unit_price_yen, amount_yen, copied_from_item_id, is_deleted";
const COST_COLUMNS = "id, case_id, category, description, amount_yen, cost_date, memo, is_deleted, created_at, updated_at";
const PROFILE_COLUMNS = "id, shop_name, address, phone, invoice_reg_no, bank_info, updated_at";
const FINANCIALS_COLUMNS =
  "case_id, adopted_estimate_id, adopted_estimate_no, adopted_estimate_version, adopted_subtotal_yen, adopted_total_yen, invoice_count, invoices_without_estimate, invoiced_subtotal_yen, cost_total_yen, revenue_basis, revenue_yen, gross_profit_yen";

const uuid = z.string().uuid();

/** 案件の見積(取り消していないもの)。番号ごとに版の新しい順 */
export async function getEstimatesByCase(caseId: string): Promise<Estimate[]> {
  if (!uuid.safeParse(caseId).success) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .select(ESTIMATE_COLUMNS)
    .eq("case_id", caseId)
    .eq("is_deleted", false)
    .order("estimate_no", { ascending: true })
    .order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => estimateRowSchema.parse(r));
}

/** 見積1件(取り消した見積は返さない) */
export async function getEstimateById(id: string): Promise<Estimate | null> {
  if (!uuid.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .select(ESTIMATE_COLUMNS)
    .eq("id", id)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw error;
  return data ? estimateRowSchema.parse(data) : null;
}

/** 見積の明細(取り消していないもの)。並び順どおり */
export async function getEstimateItems(estimateId: string): Promise<EstimateItem[]> {
  if (!uuid.safeParse(estimateId).success) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimate_items")
    .select(ITEM_COLUMNS)
    .eq("estimate_id", estimateId)
    .eq("is_deleted", false)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => estimateItemRowSchema.parse(r));
}

/** 同じ見積番号の版の一覧(新しい順)。版の切り替えと「新しい版があるか」に使う */
export async function getEstimateVersions(estimateNo: string): Promise<Pick<Estimate, "id" | "version" | "status">[]> {
  const parsed = z.string().min(1).max(40).safeParse(estimateNo);
  if (!parsed.success) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimates")
    .select("id, version, status")
    .eq("estimate_no", parsed.data)
    .eq("is_deleted", false)
    .order("version", { ascending: false });
  if (error) throw error;
  const row = z.object({ id: uuid, version: z.coerce.number().int(), status: estimateRowSchema.shape.status });
  return (data ?? []).map((r) => row.parse(r));
}

/** 案件の原価(取り消していないもの)。新しい日付順 */
export async function getCostsByCase(caseId: string): Promise<Cost[]> {
  if (!uuid.safeParse(caseId).success) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("costs")
    .select(COST_COLUMNS)
    .eq("case_id", caseId)
    .eq("is_deleted", false)
    .order("cost_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => costRowSchema.parse(r));
}

/** 案件の粗利(税抜)。取り消した案件は出ない */
export async function getCaseFinancials(caseId: string): Promise<CaseFinancials | null> {
  if (!uuid.safeParse(caseId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("case_financials")
    .select(FINANCIALS_COLUMNS)
    .eq("case_id", caseId)
    .maybeSingle();
  if (error) throw error;
  return data ? caseFinancialsRowSchema.parse(data) : null;
}

/** 事業者情報(1行だけ)。無ければ null */
export async function getBusinessProfile(): Promise<BusinessProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("business_profile").select(PROFILE_COLUMNS).limit(1).maybeSingle();
  if (error) throw error;
  return data ? businessProfileRowSchema.parse(data) : null;
}

/** 見積から作った請求(取り消していないもの)の id。無ければ null */
export async function getInvoiceIdByEstimate(estimateId: string): Promise<string | null> {
  if (!uuid.safeParse(estimateId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id")
    .eq("estimate_id", estimateId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw error;
  return data ? z.object({ id: uuid }).parse(data).id : null;
}

// ── 前回の見積と施工(SPEC-v2 §5.5・D94-4) ─────────────────────────────────────

export type ReferenceGroupKey = "room" | "building" | "client";

export type ReferenceJob = { job_date: string; work_type: string | null; content: string | null };

/** 前回の案件1件。見積があれば見積と明細を、無ければ(v1 から移した案件など)施工だけを持つ */
export type ReferenceCase = {
  group: ReferenceGroupKey;
  caseId: string;
  caseNo: string;
  caseStatus: string;
  receivedOn: string;
  buildingName: string;
  roomNo: string | null;
  clientName: string;
  estimate: Estimate | null;
  items: EstimateItem[];
  jobs: ReferenceJob[];
};

const REFERENCE_PER_GROUP = 5;
const REFERENCE_FETCH_LIMIT = 200;
const JOBS_PER_CASE = 3;

const referenceCaseSchema = z.object({
  id: uuid,
  case_no: z.string(),
  building_id: uuid,
  unit_id: uuid.nullable(),
  client_id: uuid,
  status: z.string(),
  received_on: z.string(),
  building: z.object({ name: z.string() }).nullable(),
  unit: z.object({ room_no: z.string().nullable() }).nullable(),
  client: z.object({ name: z.string() }).nullable(),
});

/**
 * 見積に添える「前回の見積と施工」。出す順は 同じ部屋 → 同じ物件の他の部屋 → 同じ発注元の他の物件(D94-4)。
 * - 取り消した案件・見積は出さない。失注した案件は、includeLost のときだけ出す(既定は出さない)。
 * - 見積は提出済・採用・不採用だけ(下書きは出さない)。1つの案件につき、いちばん新しい見積を1つ。
 * - v1 から移した案件のように見積が無くても、施工があれば出す(施工だけ)。見積も施工も無い案件は出さない。
 * - 同じ案件(いまの案件)は出さない。同じ案件の前の版は「出し直し」で写す。
 * 点数づけはしない。どれを写すかは人が決める(昇格順ガード)。
 */
export async function getEstimateReferences(
  estimate: Estimate,
  options: { includeLost?: boolean } = {}
): Promise<ReferenceCase[]> {
  const supabase = await createClient();

  const { data: caseData, error: caseError } = await supabase
    .from("cases")
    .select("id, building_id, unit_id, client_id")
    .eq("id", estimate.case_id)
    .maybeSingle();
  if (caseError) throw caseError;
  if (!caseData) return [];
  const target = z
    .object({ id: uuid, building_id: uuid, unit_id: uuid.nullable(), client_id: uuid })
    .parse(caseData);

  // 部屋・物件・発注元のどれかが同じ案件を、まとめて取って分ける
  const conditions = [`building_id.eq.${target.building_id}`, `client_id.eq.${target.client_id}`];
  if (target.unit_id) conditions.push(`unit_id.eq.${target.unit_id}`);

  let casesQuery = supabase
    .from("cases")
    .select(
      "id, case_no, building_id, unit_id, client_id, status, received_on, building:buildings(name), unit:units(room_no), client:clients(name)"
    )
    .eq("is_deleted", false)
    .neq("id", target.id)
    .or(conditions.join(","))
    .order("received_on", { ascending: false })
    .limit(REFERENCE_FETCH_LIMIT);
  if (!options.includeLost) casesQuery = casesQuery.neq("status", "失注");
  const casesRes = await casesQuery;
  if (casesRes.error) throw casesRes.error;
  const cases = (casesRes.data ?? []).map((r) => referenceCaseSchema.parse(r));
  if (cases.length === 0) return [];
  const caseIds = cases.map((c) => c.id);

  const [estimatesRes, jobsRes] = await Promise.all([
    supabase
      .from("estimates")
      .select(ESTIMATE_COLUMNS)
      .in("case_id", caseIds)
      .in("status", ["提出済", "採用", "不採用"])
      .eq("is_deleted", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("jobs")
      .select("case_id, job_date, work_type, content")
      .in("case_id", caseIds)
      .eq("is_deleted", false)
      .order("job_date", { ascending: false }),
  ]);
  if (estimatesRes.error) throw estimatesRes.error;
  if (jobsRes.error) throw jobsRes.error;

  const estimateByCase = new Map<string, Estimate>();
  for (const raw of estimatesRes.data ?? []) {
    const e = estimateRowSchema.parse(raw);
    if (!estimateByCase.has(e.case_id)) estimateByCase.set(e.case_id, e); // 新しい順なので、最初の1件が最新
  }
  const jobRow = z.object({ case_id: uuid, job_date: z.string(), work_type: z.string().nullable(), content: z.string().nullable() });
  const jobsByCase = new Map<string, ReferenceJob[]>();
  for (const raw of jobsRes.data ?? []) {
    const j = jobRow.parse(raw);
    const list = jobsByCase.get(j.case_id) ?? [];
    if (list.length < JOBS_PER_CASE) list.push({ job_date: j.job_date, work_type: j.work_type, content: j.content });
    jobsByCase.set(j.case_id, list);
  }

  // 見積も施工も無い案件は出さない。出す順に、グループごとに5件まで
  const counts: Record<ReferenceGroupKey, number> = { room: 0, building: 0, client: 0 };
  const chosen: { group: ReferenceGroupKey; c: z.infer<typeof referenceCaseSchema> }[] = [];
  for (const c of cases) {
    if (!estimateByCase.has(c.id) && !jobsByCase.has(c.id)) continue;
    const group: ReferenceGroupKey | null =
      target.unit_id && c.unit_id === target.unit_id
        ? "room"
        : c.building_id === target.building_id
          ? "building"
          : c.client_id === target.client_id
            ? "client"
            : null;
    if (!group || counts[group] >= REFERENCE_PER_GROUP) continue;
    counts[group] += 1;
    chosen.push({ group, c });
  }
  if (chosen.length === 0) return [];

  const estimateIds = chosen.map(({ c }) => estimateByCase.get(c.id)?.id).filter((id): id is string => Boolean(id));
  const itemsByEstimate = new Map<string, EstimateItem[]>();
  if (estimateIds.length > 0) {
    const itemsRes = await supabase
      .from("estimate_items")
      .select(ITEM_COLUMNS)
      .in("estimate_id", estimateIds)
      .eq("is_deleted", false)
      .order("sort_order", { ascending: true });
    if (itemsRes.error) throw itemsRes.error;
    for (const raw of itemsRes.data ?? []) {
      const item = estimateItemRowSchema.parse(raw);
      itemsByEstimate.set(item.estimate_id, [...(itemsByEstimate.get(item.estimate_id) ?? []), item]);
    }
  }

  const order: ReferenceGroupKey[] = ["room", "building", "client"];
  return chosen
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
    .map(({ group, c }) => {
      const est = estimateByCase.get(c.id) ?? null;
      return {
        group,
        caseId: c.id,
        caseNo: c.case_no,
        caseStatus: c.status,
        receivedOn: c.received_on,
        buildingName: c.building?.name ?? "(物件不明)",
        roomNo: c.unit?.room_no ?? null,
        clientName: c.client?.name ?? "(発注元不明)",
        estimate: est,
        items: est ? (itemsByEstimate.get(est.id) ?? []) : [],
        jobs: jobsByCase.get(c.id) ?? [],
      };
    });
}
