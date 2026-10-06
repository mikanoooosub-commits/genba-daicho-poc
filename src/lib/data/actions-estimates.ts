"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import {
  businessProfileInputSchema,
  changeEstimateStatusInputSchema,
  copyEstimateItemsInputSchema,
  costDeletedInputSchema,
  createCostInputSchema,
  createEstimateInputSchema,
  createInvoiceFromEstimateInputSchema,
  estimateIdInputSchema,
  saveEstimateInputSchema,
  updateCostInputSchema,
  type BusinessProfileInput,
  type ChangeEstimateStatusInput,
  type CopyEstimateItemsInput,
  type CreateCostInput,
  type CreateInvoiceFromEstimateInput,
  type SaveEstimateInput,
  type UpdateCostInput,
} from "@/lib/validation/estimate";

// 見積・原価・事業者情報の Server Actions(WO-011 段階3)。
// クライアントから来る値は無条件に信用せず、必ず zod の safeParse を通してから DB に渡す。
// 物理 DELETE は行わない(論理削除のみ)。
// 見積の小計・税・合計、明細の金額は DB が計算する。ここでは金額の計算結果を受け取らない・書かない。
// 提出済の見積の保護・採用は1案件に1つ・見積由来の請求の金額固定は DB のトリガーが守る(migration_008)。
// 状態を進める・金額を決める(採用)のは人。このファイルは、人が押した操作を記録するだけ(提案は画面側)。

function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "入力内容を確認してください";
}

/** Supabase のエラーは Error ではなく message を持つ普通のオブジェクト。DB のトリガーが出した理由を画面に出す */
function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  const parsed = z.object({ message: z.string().min(1) }).safeParse(e);
  return parsed.success ? parsed.data.message : fallback;
}

function toNullableText(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

const idRow = z.object({ id: z.string().uuid() });

function revalidateEstimate(estimateId: string, caseId?: string) {
  revalidatePath(`/estimates/${estimateId}`);
  if (caseId) revalidatePath(`/cases/${caseId}`);
}

/** 案件から見積を作って、見積の画面へ移る(遷移は redirect。try/catch の外で呼ぶ) */
export async function createEstimateAction(input: { caseId: string }): Promise<ActionResult> {
  const parsed = createEstimateInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  let estimateId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("estimates").insert({ case_id: parsed.data.caseId }).select("id").single();
    if (error) throw error;
    estimateId = idRow.parse(data).id;
  } catch (e) {
    return { ok: false, error: errorMessage(e, "見積を作れませんでした") };
  }
  revalidatePath(`/cases/${parsed.data.caseId}`);
  redirect(`/estimates/${estimateId}`);
}

/**
 * 下書きの見積を保存する(税率・備考・有効期限+明細)。
 * 明細は DB 関数 save_estimate_items で1回の処理で保存する(途中で失敗したら何も保存されない)。
 * 値引きは、画面では正の金額で受け取り、ここで符号を反転して保存する(DB は値引きの単価 ≤ 0 を要求する)。
 * 合計は DB が計算して保存する(この関数は受け取らない)。
 */
export async function saveEstimateAction(input: SaveEstimateInput): Promise<ActionResult> {
  const parsed = saveEstimateInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const data = parsed.data;

  try {
    const supabase = await createClient();
    const { data: head, error: headError } = await supabase
      .from("estimates")
      .update({
        tax_rate_pct: data.taxRatePct,
        note: toNullableText(data.note),
        valid_until: data.validUntil ? data.validUntil : null,
      })
      .eq("id", data.estimateId)
      .eq("is_deleted", false)
      .select("id, case_id")
      .maybeSingle();
    if (headError) throw headError;
    if (!head) return { ok: false, error: "見積が見つかりません" };
    const caseId = z.object({ case_id: z.string().uuid() }).parse(head).case_id;

    const items = data.items.map((it) => ({
      ...(it.id ? { id: it.id } : {}),
      category: it.category,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit ?? "",
      unit_price_yen: it.category === "値引き" ? -it.unitPrice : it.unitPrice,
      ...(it.copiedFromItemId ? { copied_from_item_id: it.copiedFromItemId } : {}),
    }));
    const { error } = await supabase.rpc("save_estimate_items", {
      p_estimate_id: data.estimateId,
      p_items: items,
    });
    if (error) throw error;
    revalidateEstimate(data.estimateId, caseId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "見積の保存に失敗しました") };
  }
}

/** 状態を進める・決める(提出済 / 採用 / 不採用。採用・不採用から提出済へ戻すのも同じ操作)。移れる先は DB が決める */
export async function changeEstimateStatusAction(input: ChangeEstimateStatusInput): Promise<ActionResult> {
  const parsed = changeEstimateStatusInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("estimates")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.estimateId)
      .eq("is_deleted", false)
      .select("id, case_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "見積が見つかりません" };
    revalidateEstimate(parsed.data.estimateId, z.object({ case_id: z.string().uuid() }).parse(data).case_id);
    revalidatePath("/cases");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "見積の状態を変えられませんでした") };
  }
}

/** 出し直し: 提出済・不採用の最新版から、版 + 1 の下書きを作って、その画面へ移る */
export async function reissueEstimateAction(input: { estimateId: string }): Promise<ActionResult> {
  const parsed = estimateIdInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  let newId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("reissue_estimate", { p_id: parsed.data.estimateId });
    if (error) throw error;
    newId = z.string().uuid().parse(data);
  } catch (e) {
    return { ok: false, error: errorMessage(e, "出し直しに失敗しました") };
  }
  revalidatePath(`/estimates/${parsed.data.estimateId}`);
  redirect(`/estimates/${newId}`);
}

/** 前回の見積の明細を、下書きに写す(写す元の値は DB 関数が読む。金額は写した先で計算し直される) */
export async function copyEstimateItemsAction(input: CopyEstimateItemsInput): Promise<ActionResult> {
  const parsed = copyEstimateItemsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("copy_estimate_items", {
      p_target_id: parsed.data.estimateId,
      p_source_item_ids: parsed.data.sourceItemIds,
    });
    if (error) throw error;
    revalidatePath(`/estimates/${parsed.data.estimateId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "明細を写せませんでした") };
  }
}

/** 下書きの見積を取り消す(論理削除。提出済は DB が断る)。案件の画面へ戻る */
export async function deleteDraftEstimateAction(input: { estimateId: string }): Promise<ActionResult> {
  const parsed = estimateIdInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  let caseId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("estimates")
      .update({ is_deleted: true })
      .eq("id", parsed.data.estimateId)
      .eq("status", "下書き")
      .eq("is_deleted", false)
      .select("id, case_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "取り消せるのは下書きの見積だけです" };
    caseId = z.object({ case_id: z.string().uuid() }).parse(data).case_id;
  } catch (e) {
    return { ok: false, error: errorMessage(e, "見積を取り消せませんでした") };
  }
  revalidatePath(`/cases/${caseId}`);
  redirect(`/cases/${caseId}`);
}

/**
 * 採用した見積から請求を作って、案件の画面へ移る。
 * 金額(税込)と税率は DB が見積から写す(ここで決めない・あとから直せない)。請求日・様式のメモ・メモは人が入れる。
 * 採用でない見積・別の案件・2つ目の請求は DB が断る。
 */
export async function createInvoiceFromEstimateAction(input: CreateInvoiceFromEstimateInput): Promise<ActionResult> {
  const parsed = createInvoiceFromEstimateInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const data = parsed.data;

  let caseId: string;
  try {
    const supabase = await createClient();
    const { data: est, error: estError } = await supabase
      .from("estimates")
      .select("id, case_id, status, total_yen")
      .eq("id", data.estimateId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (estError) throw estError;
    if (!est) return { ok: false, error: "見積が見つかりません" };
    const e = z
      .object({ id: z.string().uuid(), case_id: z.string().uuid(), status: z.string(), total_yen: z.coerce.number().int() })
      .parse(est);
    if (e.status !== "採用") return { ok: false, error: "採用した見積からだけ請求を作れます" };
    caseId = e.case_id;

    // site_id は DB のトリガーが案件のものに揃える。amount は見積の合計(DB が写す)
    const { error } = await supabase.from("invoices").insert({
      case_id: e.case_id,
      estimate_id: e.id,
      amount: e.total_yen,
      format_pattern: toNullableText(data.formatPattern),
      issue_date: data.issueDate ? data.issueDate : null,
      memo: toNullableText(data.memo),
    });
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: errorMessage(e, "請求を作れませんでした") };
  }
  revalidatePath("/ledger");
  revalidatePath("/cases");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/estimates/${data.estimateId}`);
  redirect(`/cases/${caseId}`);
}

// ── 原価 ──────────────────────────────────────────────────────────────────

/** 原価を入れる(税抜の整数円。外注先は屋号までにし、個人名は書かない) */
export async function createCostAction(input: CreateCostInput): Promise<ActionResult> {
  const parsed = createCostInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const d = parsed.data;

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("costs").insert({
      case_id: d.caseId,
      category: d.category,
      description: d.description,
      amount_yen: d.amountYen,
      cost_date: d.costDate,
      memo: toNullableText(d.memo),
    });
    if (error) throw error;
    revalidatePath(`/cases/${d.caseId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "原価を入れられませんでした") };
  }
}

export async function updateCostAction(input: UpdateCostInput): Promise<ActionResult> {
  const parsed = updateCostInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const d = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("costs")
      .update({
        category: d.category,
        description: d.description,
        amount_yen: d.amountYen,
        cost_date: d.costDate,
        memo: toNullableText(d.memo),
      })
      .eq("id", d.costId)
      .eq("is_deleted", false)
      .select("id, case_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "原価が見つかりません" };
    revalidatePath(`/cases/${z.object({ case_id: z.string().uuid() }).parse(data).case_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "原価を直せませんでした") };
  }
}

/** 原価の取り消し・元に戻す(論理削除。変更は監査ログに残る) */
export async function setCostDeletedAction(input: { costId: string; isDeleted: boolean }): Promise<ActionResult> {
  const parsed = costDeletedInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("costs")
      .update({ is_deleted: parsed.data.isDeleted })
      .eq("id", parsed.data.costId)
      .select("id, case_id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "原価が見つかりません" };
    revalidatePath(`/cases/${z.object({ case_id: z.string().uuid() }).parse(data).case_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "原価を取り消せませんでした") };
  }
}

// ── 事業者情報 ────────────────────────────────────────────────────────────

/** 事業者情報を直す(1行だけ。見積書に載る)。登録番号は空でもよい(未登録・免税) */
export async function updateBusinessProfileAction(input: BusinessProfileInput): Promise<ActionResult> {
  const parsed = businessProfileInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const d = parsed.data;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("business_profile")
      .update({
        shop_name: d.shopName,
        address: toNullableText(d.address),
        phone: toNullableText(d.phone),
        invoice_reg_no: toNullableText(d.invoiceRegNo),
        bank_info: toNullableText(d.bankInfo),
      })
      .eq("singleton", true)
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) return { ok: false, error: "事業者情報が見つかりません" };
    revalidatePath("/settings/business-profile");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "事業者情報を保存できませんでした") };
  }
}
