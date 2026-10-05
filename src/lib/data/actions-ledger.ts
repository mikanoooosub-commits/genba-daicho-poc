"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { findCaseIdBySite } from "@/lib/data/queries-cases";
import { getDeletedInvoices, getInvoiceById, getPaymentsForInvoice } from "@/lib/data/queries-ledger";
import type { ActionResult, AuditLogWithUser, Invoice, Payment } from "@/lib/types";
import {
  auditLogQuerySchema,
  auditLogRowSchema,
  createInvoiceSchema,
  createPaymentSchema,
  parseOrThrow,
  setInvoiceDeletedSchema,
  setPaymentDeletedSchema,
  updateInvoiceSchema,
  updatePaymentSchema,
} from "@/lib/validation/invoice";

/** zod の safeParse 失敗を、フォームにそのまま出せる1行メッセージにする */
function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "入力内容を確認してください";
}

// ── 請求(invoices) ──────────────────────────────────────────────────────────

export async function createInvoiceAction(input: unknown): Promise<ActionResult> {
  const parsed = createInvoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    // 現場に案件が結びついていれば、請求を案件につなぐ(D87。site_id は DB のトリガーが案件のものに揃える)
    const caseId = await findCaseIdBySite(parsed.data.siteId);
    const { error } = await supabase.from("invoices").insert({
      site_id: parsed.data.siteId,
      case_id: caseId,
      amount: parsed.data.amount,
      format_pattern: parsed.data.formatPattern,
      issue_date: parsed.data.issueDate || null,
      memo: parsed.data.memo,
    });
    if (error) throw error;

    revalidatePath("/ledger");
    revalidatePath(`/sites/${parsed.data.siteId}`);
    revalidatePath("/cases");
    if (caseId) revalidatePath(`/cases/${caseId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "請求の登録に失敗しました" };
  }
}

export async function updateInvoiceAction(input: unknown): Promise<ActionResult> {
  const parsed = updateInvoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("invoices")
      .update({
        site_id: parsed.data.siteId,
        amount: parsed.data.amount,
        format_pattern: parsed.data.formatPattern,
        issue_date: parsed.data.issueDate || null,
        memo: parsed.data.memo,
      })
      .eq("id", parsed.data.id);
    if (error) throw error;

    revalidatePath("/ledger");
    revalidatePath(`/sites/${parsed.data.siteId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "請求の更新に失敗しました" };
  }
}

/**
 * 請求の論理削除/復元。PM決定(D38-3)により、削除(isDeleted=true)は理由メモ必須。
 *
 * 実装メモ: log_entity_changes トリガーは「is_deleted が false→true になった UPDATE」を
 * action='delete' として記録し、その際 after_data は null にする設計(schema_poc.sql)。
 * 削除理由を audit_logs から追跡できるようにするため、
 *   ①まず memo に理由を追記する UPDATE(is_deleted はまだ false のまま)→ action='update' のログが残る
 *   ②続けて is_deleted=true にする UPDATE → action='delete' のログの before_data に
 *     ①で追記した理由入りのmemoが載る
 * の2段階に分けている。トリガー自体は変更していない(共有スキーマへの影響を避けるため)。
 */
export async function setInvoiceDeletedAction(input: unknown): Promise<ActionResult> {
  const parsed = setInvoiceDeletedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const { invoiceId, isDeleted, reason } = parsed.data;

  try {
    const supabase = await createClient();

    if (isDeleted && reason) {
      const { data: current, error: fetchError } = await supabase
        .from("invoices")
        .select("memo")
        .eq("id", invoiceId)
        .maybeSingle();
      if (fetchError) throw fetchError;
      const currentMemo = current ? z.object({ memo: z.string().nullable() }).parse(current).memo : null;

      const { error: memoError } = await supabase
        .from("invoices")
        .update({ memo: appendReasonToMemo(currentMemo, reason) })
        .eq("id", invoiceId);
      if (memoError) throw memoError;
    }

    const { error } = await supabase.from("invoices").update({ is_deleted: isDeleted }).eq("id", invoiceId);
    if (error) throw error;

    revalidatePath("/ledger");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "操作に失敗しました" };
  }
}

// ── 入金(payments) ──────────────────────────────────────────────────────────

export async function createPaymentAction(input: unknown): Promise<ActionResult> {
  const parsed = createPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("payments").insert({
      invoice_id: parsed.data.invoiceId,
      payment_date: parsed.data.paymentDate,
      amount: parsed.data.amount,
      reconciliation_status: parsed.data.reconciliationStatus ?? "unmatched",
      memo: parsed.data.memo,
    });
    if (error) throw error;

    revalidatePath("/ledger");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "入金の登録に失敗しました" };
  }
}

export async function updatePaymentAction(input: unknown): Promise<ActionResult> {
  const parsed = updatePaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("payments")
      .update({
        invoice_id: parsed.data.invoiceId,
        payment_date: parsed.data.paymentDate,
        amount: parsed.data.amount,
        reconciliation_status: parsed.data.reconciliationStatus ?? "unmatched",
        memo: parsed.data.memo,
      })
      .eq("id", parsed.data.id);
    if (error) throw error;

    revalidatePath("/ledger");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "入金の更新に失敗しました" };
  }
}

/** 入金の論理削除/復元。削除は理由メモ必須(会計上の相殺=マイナス行は使わない。PM決定D38-3)。 */
export async function setPaymentDeletedAction(input: unknown): Promise<ActionResult> {
  const parsed = setPaymentDeletedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };
  const { paymentId, isDeleted, reason } = parsed.data;

  try {
    const supabase = await createClient();

    if (isDeleted && reason) {
      const { data: current, error: fetchError } = await supabase
        .from("payments")
        .select("memo")
        .eq("id", paymentId)
        .maybeSingle();
      if (fetchError) throw fetchError;
      const currentMemo = current ? z.object({ memo: z.string().nullable() }).parse(current).memo : null;

      const { error: memoError } = await supabase
        .from("payments")
        .update({ memo: appendReasonToMemo(currentMemo, reason) })
        .eq("id", paymentId);
      if (memoError) throw memoError;
    }

    const { error } = await supabase.from("payments").update({ is_deleted: isDeleted }).eq("id", paymentId);
    if (error) throw error;

    revalidatePath("/ledger");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "操作に失敗しました" };
  }
}

function appendReasonToMemo(memo: string | null, reason: string): string {
  const base = memo?.trim() ? memo.trim() : "";
  const stamp = new Date().toISOString();
  const note = `[取消理由 ${stamp}] ${reason.trim()}`;
  return base ? `${base}\n${note}` : note;
}

// ── 監査ログ ────────────────────────────────────────────────────────────────

/**
 * Supabase/Postgrestのエラー(素のオブジェクトで `instanceof Error` にならない)や
 * 未知の例外を、UIにそのまま出しても意味が通る1行メッセージに変換する。
 * 理由(ISSUE-003): 生のエラーオブジェクトをthrow/表示すると
 * 「{code: ..., details: Null, hint: Null, message: ...}」のような原因不明の文言に
 * なってしまうため、`message` プロパティだけを安全に取り出す。
 */
function toErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return fallback;
}

export type AuditLogsResult = { ok: true; logs: AuditLogWithUser[] } | { ok: false; error: string };

/**
 * jobs/invoices/payments 共通の監査ログ取得(SPEC.md §7)。entity_type は jobs も受け付けるため、
 * 実装A(現場詳細の施工履歴・`job-log-dialog.tsx`)からも呼べる想定。
 *
 * ISSUE-003対応: 以前は `if (error) throw error` で生のSupabaseエラーをそのまま
 * throwしていたため、UIに原因不明のプレースホルダー文言が表示される不具合があった。
 * 呼び出し側には Result型({ok:true, logs} | {ok:false, error})で返し、決してthrowしない。
 *
 * ISSUE-010対応: 以前は記録者名の解決に `profiles` テーブルを参照していたが、この
 * Supabaseプロジェクトには `profiles` テーブルが存在しない(テスト役が
 * `GET /rest/v1/profiles` → `PGRST205: Could not find the table 'public.profiles'` をREST APIで
 * 確認済み。CHANGE-B-012の非致命化により画面は壊れないが、常に「不明なユーザー」表示になっていた)。
 * DBスキーマは変更しない方針のため、`profiles` を新設する代わりに `supabase.auth.getUser()` で
 * 現在ログイン中のユーザーだけを判定し、`audit_logs.user_id` と一致する行を「自分(メール)」、
 * 一致しない行を「他のユーザー(idの先頭8桁)」と表示する(単一〜少人数運用のPoC前提。
 * 他人のメールアドレスは持っていないため出せない。ログイン済み本人のメールアドレスのみを扱う)。
 */
export async function getAuditLogsAction(input: unknown): Promise<AuditLogsResult> {
  const parsed = auditLogQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssueMessage(parsed.error) };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, entity_type, entity_id, user_id, action, before_data, after_data, created_at")
      .eq("entity_type", parsed.data.entityType)
      .eq("entity_id", parsed.data.entityId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const logs = parseOrThrow(z.array(auditLogRowSchema), data ?? [], "audit_logs");

    // 表示名解決に使うのは「今ログインしている自分が誰か」だけ(profilesの代替)。
    // 失敗しても致命的にせず、全行「他のユーザー」フォールバックにする(監査ログ本体は失わない)。
    let currentUserId: string | null = null;
    let currentUserEmail: string | null = null;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      currentUserId = user?.id ?? null;
      currentUserEmail = user?.email ?? null;
    } catch (authLookupError) {
      console.error(
        "getAuditLogsAction: 現在ユーザー(auth.getUser)の解決に失敗しました。監査ログ本体の表示は継続します。",
        authLookupError
      );
    }

    function resolveUserName(userId: string | null): string | null {
      if (!userId) return null;
      if (currentUserId && userId === currentUserId) {
        return `自分（${currentUserEmail ?? "メールアドレス不明"}）`;
      }
      return `他のユーザー（${userId.slice(0, 8)}）`;
    }

    return {
      ok: true,
      logs: logs.map((l) => ({ ...l, userName: resolveUserName(l.user_id) })),
    };
  } catch (e) {
    return { ok: false, error: toErrorMessage(e, "変更履歴の取得に失敗しました") };
  }
}

// ── 台帳・集計(クライアントコンポーネントからのオンデマンド取得用ラッパー) ────
// ページ本体(/ledger)・現場詳細パネルはいずれも Server Component として
// queries-ledger.ts (getInvoiceLedger/summarizeInvoiceLedger)を直接呼ぶため、
// Server Action版(getInvoiceLedgerAction/getLedgerSummaryAction)はUIから未使用だった。
// PM決定(SPEC.md §12 B-3)により削除(CHANGE-R-001)。必要になったら復活する。

/** 請求編集フォームの初期値取得(現場詳細・台帳の両方の編集ダイアログから使う) */
export async function getInvoiceByIdAction(id: unknown): Promise<Invoice | null> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) throw new Error("不正な請求IDです");
  return getInvoiceById(parsed.data);
}

const getPaymentsOptionsSchema = z.object({ includeDeleted: z.boolean().optional() });

/**
 * 1請求の入金明細取得(PaymentList が展開時にオンデマンドで呼ぶ)。
 * `options.includeDeleted` は「取消済みを表示」チェックボックスから渡される(ISSUE-007)。
 * クライアントから来る値のため、無条件に信用せずzodで検証してから使う。
 */
export async function getPaymentsForInvoiceAction(
  invoiceId: unknown,
  options?: unknown
): Promise<Payment[]> {
  const parsedId = z.string().uuid().safeParse(invoiceId);
  if (!parsedId.success) throw new Error("不正な請求IDです");
  const parsedOptions = getPaymentsOptionsSchema.safeParse(options ?? {});
  return getPaymentsForInvoice(parsedId.data, {
    includeDeleted: parsedOptions.success ? parsedOptions.data.includeDeleted ?? false : false,
  });
}

const getDeletedInvoicesInputSchema = z.object({ siteId: z.string().uuid().optional() });

/**
 * 取消済み(is_deleted=true)の請求一覧取得(ISSUE-007)。台帳画面・現場詳細の
 * 「取消済みを表示」チェックボックスから、いずれもクライアントコンポーネントからオンデマンドで呼ぶ。
 */
export async function getDeletedInvoicesAction(input?: unknown): Promise<Invoice[]> {
  const parsed = getDeletedInvoicesInputSchema.safeParse(input ?? {});
  return getDeletedInvoices(parsed.success ? { siteId: parsed.data.siteId } : {});
}
