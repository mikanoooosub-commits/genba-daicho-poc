"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import {
  caseDeletedInputSchema,
  changeCaseStatusInputSchema,
  createCaseInputSchema,
  updateCaseInputSchema,
  type ChangeCaseStatusInput,
  type CreateCaseInput,
  type UpdateCaseInput,
} from "@/lib/validation/case";
import type { LEAD_SOURCES } from "@/lib/validation/site";

// 案件の Server Actions(WO-011 段階2)。
// クライアントから来る値は無条件に信用せず、必ず zod の safeParse を通してから DB に渡す。
// 物理 DELETE は行わない(論理削除のみ)。
// sites 行(案件ごとに1つ)は DB のトリガーが作る・直す(migration_006)。ここでは触らない。
// 金額・状態の変更を決めるのは人。このファイルは、人が押した操作を記録するだけ(提案は画面側)。

function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "入力内容を確認してください";
}

/**
 * Supabase のエラー(PostgrestError)は Error のインスタンスではなく、message を持つ普通のオブジェクト。
 * DB のトリガーが出した理由(「先に請求・入金を取り消してください」など)を画面に出すため、message を取り出す。
 */
function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  const parsed = z.object({ message: z.string().min(1) }).safeParse(e);
  return parsed.success ? parsed.data.message : fallback;
}

function toNullableText(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

type LeadSource = (typeof LEAD_SOURCES)[number];

/** 発注元の種類から、集客経路の初期値を決める(画面で直せるようにはまだしていない。その他に倒す) */
function defaultLeadSource(clientType: string): LeadSource {
  switch (clientType) {
    case "管理会社":
      return "管理会社";
    case "FC本部":
      return "本部紹介";
    case "紹介":
      return "紹介";
    case "マッチング":
      return "マッチング";
    default:
      return "その他";
  }
}

/**
 * 案件を登録して、案件の画面へ移る。
 * 「新しい物件」「新しい部屋番号」を同時に作ることもできる(現場でスマホ1分)。
 * 案件の登録に失敗したら、一緒に作った物件・部屋を論理削除して戻す(物理削除はしない)。
 * 遷移は redirect() で行う(try/catch の外で呼ぶ。catch の中だと通常のエラーとして握りつぶされる)。
 */
export async function createCaseAction(input: CreateCaseInput): Promise<ActionResult> {
  const parsed = createCaseInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const data = parsed.data;

  let caseId: string;
  const createdBuildingIds: string[] = [];
  const createdUnitIds: string[] = [];
  const supabase = await createClient();
  try {
    const { data: clientRow, error: clientError } = await supabase
      .from("clients")
      .select("type")
      .eq("id", data.clientId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!clientRow) return { ok: false, error: "発注元が見つかりません" };
    const clientType = z.object({ type: z.string() }).parse(clientRow).type;

    let buildingId = data.buildingId;
    if (!buildingId) {
      const { data: b, error: bError } = await supabase
        .from("buildings")
        .insert({
          name: data.newBuildingName,
          kind: data.newBuildingKind ?? "集合住宅",
          default_client_id: data.clientId,
        })
        .select("id")
        .single();
      if (bError) throw bError;
      buildingId = z.object({ id: z.string().uuid() }).parse(b).id;
      createdBuildingIds.push(buildingId);
    }

    let unitId = data.unitId ?? null;
    if (data.newRoomNo) {
      // 同じ番号の部屋が既にあれば、それを使う(二重に作らない)
      const { data: existing, error: eError } = await supabase
        .from("units")
        .select("id")
        .eq("building_id", buildingId)
        .eq("room_no", data.newRoomNo)
        .eq("is_deleted", false)
        .maybeSingle();
      if (eError) throw eError;
      if (existing) {
        unitId = z.object({ id: z.string().uuid() }).parse(existing).id;
      } else {
        const { data: u, error: uError } = await supabase
          .from("units")
          .insert({ building_id: buildingId, room_no: data.newRoomNo })
          .select("id")
          .single();
        if (uError) throw uError;
        unitId = z.object({ id: z.string().uuid() }).parse(u).id;
        createdUnitIds.push(unitId);
      }
    }

    const { data: c, error: cError } = await supabase
      .from("cases")
      .insert({
        building_id: buildingId,
        unit_id: unitId,
        client_id: data.clientId,
        lead_source: data.leadSource ?? defaultLeadSource(clientType),
        work_kind: data.workKind,
        // 受付日は今日(日本時間)。DB の既定値(current_date)は UTC なので、朝9時前は前日になってしまう
        received_on: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
        request_summary: toNullableText(data.requestSummary),
      })
      .select("id")
      .single();
    if (cError) throw cError;
    caseId = z.object({ id: z.string().uuid() }).parse(c).id;
  } catch (e) {
    // 案件を作れなかったときは、この操作で作った部屋・物件を論理削除で戻す
    if (createdUnitIds.length > 0) await supabase.from("units").update({ is_deleted: true }).in("id", createdUnitIds);
    if (createdBuildingIds.length > 0)
      await supabase.from("buildings").update({ is_deleted: true }).in("id", createdBuildingIds);
    return { ok: false, error: errorMessage(e, "案件の登録に失敗しました") };
  }

  revalidatePath("/cases");
  revalidatePath("/buildings");
  redirect(`/cases/${caseId}?new=1`);
}

/**
 * 案件の編集(依頼の内容・種類・受付日・集客経路・発注元)。打ち間違いを直すための操作。
 * 変更は監査ログに残る。発注元・集客経路を変えると、DB のトリガーが案件の sites 行にも写す
 * (v1 の台帳の発注元・集客経路の集計が変わる)。物件・部屋は変えない。取り消し済みの案件は直せない。
 * 遷移は redirect() で行う(try/catch の外で呼ぶ)。
 */
export async function updateCaseAction(input: UpdateCaseInput): Promise<ActionResult> {
  const parsed = updateCaseInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const data = parsed.data;

  try {
    const supabase = await createClient();
    const { data: updated, error } = await supabase
      .from("cases")
      .update({
        client_id: data.clientId,
        work_kind: data.workKind,
        lead_source: data.leadSource,
        received_on: data.receivedOn,
        request_summary: toNullableText(data.requestSummary),
      })
      .eq("id", data.caseId)
      .eq("is_deleted", false)
      .select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) return { ok: false, error: "取り消し済みの案件は直せません" };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "案件の更新に失敗しました") };
  }

  revalidatePath("/cases");
  revalidatePath(`/cases/${data.caseId}`);
  revalidatePath("/ledger");
  redirect(`/cases/${data.caseId}`);
}

/** 状態を変える(進めるのも戻すのも同じ操作。変更は監査ログに残る)。失注のときは理由を任意で残す */
export async function changeCaseStatusAction(input: ChangeCaseStatusInput): Promise<ActionResult> {
  const parsed = changeCaseStatusInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("cases")
      .update({
        status: parsed.data.status,
        lost_reason: parsed.data.status === "失注" ? toNullableText(parsed.data.lostReason) : null,
      })
      .eq("id", parsed.data.caseId)
      .eq("is_deleted", false);
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: errorMessage(e, "状態の変更に失敗しました") };
  }

  revalidatePath("/cases");
  revalidatePath(`/cases/${parsed.data.caseId}`);
  return { ok: true };
}

/**
 * 案件の論理削除/復元。生きている請求・入金がある案件は、DB のトリガーが断る
 * (先にそれらを取り消す。メッセージはそのまま画面に出す)。取り消すと、その案件の sites 行も取り消される。
 * 施工は案件を取り消しても残る。物理 DELETE はしない。
 */
export async function setCaseDeletedAction(caseId: string, isDeleted: boolean): Promise<ActionResult> {
  const parsed = caseDeletedInputSchema.safeParse({ caseId, isDeleted });
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("cases")
      .update({ is_deleted: parsed.data.isDeleted })
      .eq("id", parsed.data.caseId);
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: errorMessage(e, "操作に失敗しました") };
  }

  revalidatePath("/cases");
  revalidatePath(`/cases/${parsed.data.caseId}`);
  revalidatePath("/buildings");
  // 取り消したあとは、一覧へ(redirect は try/catch の外で呼ぶ)
  if (parsed.data.isDeleted) redirect("/cases");
  return { ok: true };
}
