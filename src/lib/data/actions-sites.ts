"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { countActiveSitesForClient } from "@/lib/data/queries-sites";
import type { ActionResult } from "@/lib/types";
import {
  clientInputSchema,
  updateClientInputSchema,
  clientDeletedInputSchema,
  siteInputSchema,
  updateSiteInputSchema,
  siteDeletedInputSchema,
  jobInputSchema,
  updateJobInputSchema,
  jobDeletedInputSchema,
  type ClientInput,
  type UpdateClientInput,
  type SiteInput,
  type UpdateSiteInput,
  type JobInput,
  type UpdateJobInput,
  type JobDeletedInput,
} from "@/lib/validation/site";

// 実装Aの担当範囲（発注元・現場・施工）の Server Actions。
// 共通CLAUDE.md方針:「クライアントから来る値は無条件に信用せず、サーバー側(Server Action内)で
// zodスキーマにより検証してからDBに渡す」。関数のパラメータ型はフォーム側のDXのために
// 具体的な型を付けているが、実行時には必ず safeParse を通す（型だけを信用しない）。

/** zod の safeParse 失敗を、フォームにそのまま出せる1行メッセージにする（actions-ledger.ts と同じ方針） */
function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "入力内容を確認してください";
}

/** "" や未入力を null に正規化する（DBの空文字と未入力を区別しないための共通処理） */
function toNullableText(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

// ── 発注元(clients) ──────────────────────────────────────────────────────────

export async function createClientAction(input: ClientInput): Promise<ActionResult> {
  const parsed = clientInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("clients").insert({
      name: parsed.data.name,
      type: parsed.data.type,
      format_memo: toNullableText(parsed.data.formatMemo),
    });
    if (error) throw error;

    revalidatePath("/clients");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "発注元の登録に失敗しました" };
  }
}

export async function updateClientAction(input: UpdateClientInput): Promise<ActionResult> {
  const parsed = updateClientInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("clients")
      .update({
        name: parsed.data.name,
        type: parsed.data.type,
        format_memo: toNullableText(parsed.data.formatMemo),
      })
      .eq("id", parsed.data.id);
    if (error) throw error;

    revalidatePath("/clients");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "発注元の更新に失敗しました" };
  }
}

/**
 * 発注元の論理削除/復元。SPEC.md §7には無いが、§10④の受入条件
 * 「発注元に紐づく現場が1件以上あるとき、発注元を削除できない、または論理削除で扱う」を
 * 満たすために実装A側で追加した（PMに判断を求める点として報告済み）。
 * 物理DELETEのServer Actionは作らない（共通CLAUDE.md方針）。
 */
export async function setClientDeletedAction(
  clientId: string,
  isDeleted: boolean
): Promise<ActionResult> {
  const parsed = clientDeletedInputSchema.safeParse({ clientId, isDeleted });
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();

    if (parsed.data.isDeleted) {
      const activeSiteCount = await countActiveSitesForClient(parsed.data.clientId);
      if (activeSiteCount > 0) {
        return { ok: false, error: "この発注元に紐づく現場があるため削除できません" };
      }
    }

    const { error } = await supabase
      .from("clients")
      .update({ is_deleted: parsed.data.isDeleted })
      .eq("id", parsed.data.clientId);
    if (error) throw error;

    revalidatePath("/clients");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "操作に失敗しました" };
  }
}

// ── 現場(sites) ──────────────────────────────────────────────────────────────

/**
 * 現場を新規作成し、その現場詳細へ遷移する。
 *
 * ISSUE-004対応: 当初はクライアント側で `createSiteAction` の戻り値(`siteId`)を受けて
 * `router.push('/sites/[id]')` していたが、実機検証でこの `push` が
 * `net::ERR_ABORTED` になり遷移しないことを確認した。原因は、このServer Action自身が
 * 呼び出し元ルート("/")の暗黙の再検証(`revalidatePath("/")`)を伴うため、
 * それによる現在ルートの再取得と、直後に呼ぶ `router.push` の新ルート取得が競合し、
 * 後者が中断されるため。`redirect()` はNext.jsがServer Actionのレスポンスとして
 * 特別に扱い、この競合を起こさずに遷移できるため、遷移自体をServer Action内に移した。
 * (`redirect()` は内部で例外を投げるため、try/catchの外で呼ぶ。catch内で呼ぶと
 * 通常のエラーとして握りつぶされ遷移しなくなる)
 */
export async function createSiteAction(input: SiteInput): Promise<ActionResult> {
  const parsed = siteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  let siteId: string;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("sites")
      .insert({
        client_id: parsed.data.clientId,
        building_name: parsed.data.buildingName,
        room_no: toNullableText(parsed.data.roomNo),
        address_memo: toNullableText(parsed.data.addressMemo),
        lat: parsed.data.lat ?? null,
        lng: parsed.data.lng ?? null,
        lead_source: parsed.data.leadSource,
      })
      .select("id")
      .single();
    if (error) throw error;

    siteId = z.object({ id: z.string().uuid() }).parse(data).id;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "現場の登録に失敗しました" };
  }

  revalidatePath("/");
  revalidatePath("/clients");
  redirect(`/sites/${siteId}`);
}

export async function updateSiteAction(input: UpdateSiteInput): Promise<ActionResult> {
  const parsed = updateSiteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("sites")
      .update({
        client_id: parsed.data.clientId,
        building_name: parsed.data.buildingName,
        room_no: toNullableText(parsed.data.roomNo),
        address_memo: toNullableText(parsed.data.addressMemo),
        lat: parsed.data.lat ?? null,
        lng: parsed.data.lng ?? null,
        lead_source: parsed.data.leadSource,
      })
      .eq("id", parsed.data.id);
    if (error) throw error;

    revalidatePath("/");
    revalidatePath(`/sites/${parsed.data.id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "現場の更新に失敗しました" };
  }
}

/**
 * 現場の論理削除/復元(ISSUE-008対応)。`setClientDeletedAction`と同じ形(位置引数・
 * `ActionResult`)にした。施工が紐づく現場でも削除できてよい(PM指示。施工自体は
 * 残り、復元すれば台帳・履歴とも元に戻る。物理DELETEはしない)。
 *
 * 削除時（isDeleted=true）だけ、CHANGE-A-011(ISSUE-004)と同じ理由で `redirect()`
 * を使い地図(`/`)へ遷移する。`redirect()`は内部で例外を投げるため、他のDB更新と
 * 同じtry/catchの中では呼ばない(catch内で呼ぶと通常のエラーとして握りつぶされ
 * 遷移しなくなる)。復元時（isDeleted=false）は同じ現場詳細ページに留まりたいため
 * `redirect()`を呼ばず`ActionResult`を返す（呼び出し元が`router.refresh()`する）。
 */
export async function setSiteDeletedAction(
  siteId: string,
  isDeleted: boolean
): Promise<ActionResult> {
  const parsed = siteDeletedInputSchema.safeParse({ siteId, isDeleted });
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("sites")
      .update({ is_deleted: parsed.data.isDeleted })
      .eq("id", parsed.data.siteId);
    if (error) throw error;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "操作に失敗しました" };
  }

  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath(`/sites/${parsed.data.siteId}`);

  if (parsed.data.isDeleted) {
    redirect("/");
  }
  return { ok: true };
}

// ── 施工(jobs) ────────────────────────────────────────────────────────────────

export async function createJobAction(input: JobInput): Promise<ActionResult> {
  const parsed = jobInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("jobs").insert({
      site_id: parsed.data.siteId,
      job_date: parsed.data.jobDate,
      work_type: toNullableText(parsed.data.workType),
      content: toNullableText(parsed.data.content),
      assignee_name: toNullableText(parsed.data.assigneeName),
      photo_urls: parsed.data.photoUrls,
      rating: parsed.data.rating,
      memo: toNullableText(parsed.data.memo),
    });
    if (error) throw error;

    revalidatePath(`/sites/${parsed.data.siteId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "施工の登録に失敗しました" };
  }
}

export async function updateJobAction(input: UpdateJobInput): Promise<ActionResult> {
  const parsed = updateJobInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("jobs")
      .update({
        site_id: parsed.data.siteId,
        job_date: parsed.data.jobDate,
        work_type: toNullableText(parsed.data.workType),
        content: toNullableText(parsed.data.content),
        assignee_name: toNullableText(parsed.data.assigneeName),
        photo_urls: parsed.data.photoUrls,
        rating: parsed.data.rating,
        memo: toNullableText(parsed.data.memo),
      })
      .eq("id", parsed.data.id);
    if (error) throw error;

    revalidatePath(`/sites/${parsed.data.siteId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "施工の更新に失敗しました" };
  }
}

/** 施工の論理削除/復元（トリガーが audit_logs に自動記録する。物理DELETEは作らない） */
export async function setJobDeletedAction(input: JobDeletedInput): Promise<ActionResult> {
  const parsed = jobDeletedInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("jobs")
      .update({ is_deleted: parsed.data.isDeleted })
      .eq("id", parsed.data.jobId)
      .select("site_id")
      .single();
    if (error) throw error;

    const siteId = z.object({ site_id: z.string().uuid() }).parse(data).site_id;
    revalidatePath(`/sites/${siteId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "操作に失敗しました" };
  }
}
