import { z } from "zod";

// 実装B(請求・入金・台帳・集計)の zod スキーマ。
// 「クライアントから来る値・Supabaseから読んだ値は無条件に信用しない」という
// 共通CLAUDE.md / poc-app/CLAUDE.md 方針に基づき、Server Actions の入力検証だけでなく
// Supabase からの読み取り結果の検証にもここのスキーマを使う(queries-ledger.ts 参照)。

const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD 形式で入力してください");

/** YYYY-MM (月フィルタ用。日付部分を持たない) */
const isoMonthString = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "月は YYYY-MM 形式で入力してください");

const nullableTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}文字以内で入力してください`)
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null));

// ── 請求(invoices) ──────────────────────────────────────────────────────────

export const createInvoiceSchema = z.object({
  siteId: z.string().uuid({ message: "現場を選択してください" }),
  amount: z.number({ invalid_type_error: "金額を入力してください" }).min(0, "金額は0以上で入力してください"),
  formatPattern: nullableTrimmedString(200),
  issueDate: z.union([isoDateString, z.literal("")]).optional().nullable(),
  memo: nullableTrimmedString(2000),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceSchema = createInvoiceSchema.extend({
  id: z.string().uuid(),
});
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;

/**
 * 論理削除/復元の入力。PM決定(D38-3): 訂正は論理削除して入れ直す運用とし、
 * 削除時(isDeleted=true)は理由メモを必須にする(マイナス行は使わない)。
 * 復元(isDeleted=false)は理由メモ不要。
 */
export const setInvoiceDeletedSchema = z
  .object({
    invoiceId: z.string().uuid(),
    isDeleted: z.boolean(),
    reason: z.string().trim().max(500, "500文字以内で入力してください").optional(),
  })
  .refine((v) => !v.isDeleted || (v.reason && v.reason.trim().length > 0), {
    message: "取消理由を入力してください",
    path: ["reason"],
  });
export type SetInvoiceDeletedInput = z.infer<typeof setInvoiceDeletedSchema>;

// ── 入金(payments) ──────────────────────────────────────────────────────────

export const RECONCILIATION_STATUSES = ["unmatched", "matched", "disputed"] as const;
export const reconciliationStatusSchema = z.enum(RECONCILIATION_STATUSES);

export const createPaymentSchema = z.object({
  invoiceId: z.string().uuid({ message: "請求を選択してください" }),
  paymentDate: isoDateString,
  amount: z.number({ invalid_type_error: "金額を入力してください" }).min(0, "金額は0以上で入力してください"),
  reconciliationStatus: reconciliationStatusSchema.optional(),
  memo: nullableTrimmedString(2000),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const updatePaymentSchema = createPaymentSchema.extend({
  id: z.string().uuid(),
});
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;

export const setPaymentDeletedSchema = z
  .object({
    paymentId: z.string().uuid(),
    isDeleted: z.boolean(),
    reason: z.string().trim().max(500, "500文字以内で入力してください").optional(),
  })
  .refine((v) => !v.isDeleted || (v.reason && v.reason.trim().length > 0), {
    message: "取消理由を入力してください",
    path: ["reason"],
  });
export type SetPaymentDeletedInput = z.infer<typeof setPaymentDeletedSchema>;

// ── 監査ログ照会 ─────────────────────────────────────────────────────────────

export const auditLogEntityTypeSchema = z.enum(["jobs", "invoices", "payments", "cases"]);

export const auditLogQuerySchema = z.object({
  entityType: auditLogEntityTypeSchema,
  entityId: z.string().uuid(),
});
export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;

// ── 台帳フィルタ ─────────────────────────────────────────────────────────────

export const ledgerFilterSchema = z.object({
  clientId: z.string().uuid().optional(),
  leadSource: z.string().trim().min(1).optional(),
  siteId: z.string().uuid().optional(),
  month: isoMonthString.optional(),
});
export type LedgerFilterInput = z.infer<typeof ledgerFilterSchema>;

// ── Supabase からの読み取り結果の検証 ────────────────────────────────────────
// 理由: 「Supabaseから読んだ値は zod スキーマで検証してから使う」(poc-app/CLAUDE.md)。
// `as` によるキャストはしない。numeric 列は PostgREST の返却形式(number/string)を
// 断定せず coerce で受ける。

export const invoiceRowSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  amount: z.coerce.number(),
  format_pattern: z.string().nullable(),
  issue_date: z.string().nullable(),
  memo: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const paymentRowSchema = z.object({
  id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  payment_date: z.string(),
  amount: z.coerce.number(),
  reconciliation_status: reconciliationStatusSchema,
  memo: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const paymentStatusSchema = z.enum(["未入金", "一部入金", "入金済"]);

/** invoice_ledger ビュー(公開契約。SPEC.md §4-3)の1行 */
export const invoiceLedgerRowSchema = z.object({
  invoice_id: z.string().uuid(),
  site_id: z.string().uuid(),
  building_name: z.string(),
  client_id: z.string().uuid(),
  client_name: z.string(),
  client_type: z.string(),
  lead_source: z.string(),
  amount: z.coerce.number(),
  format_pattern: z.string().nullable(),
  issue_date: z.string().nullable(),
  issue_month: z.string().nullable(),
  paid_amount: z.coerce.number(),
  payment_status: paymentStatusSchema,
});

export const auditLogRowSchema = z.object({
  id: z.string().uuid(),
  entity_type: auditLogEntityTypeSchema,
  entity_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  action: z.enum(["create", "update", "delete"]),
  before_data: z.record(z.string(), z.unknown()).nullable(),
  after_data: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

export const profileRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  display_name: z.string().nullable(),
});

export const clientOptionRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export const siteOptionRowSchema = z.object({
  id: z.string().uuid(),
  building_name: z.string(),
  room_no: z.string().nullable(),
  client_id: z.string().uuid(),
});

/** zod の safeParse 失敗を、原因が追いやすいエラーとして投げる共通ヘルパー */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`${context}: 想定形式と一致しないデータを検出しました(${result.error.message})`);
  }
  return result.data;
}
