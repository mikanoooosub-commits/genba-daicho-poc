import { z } from "zod";

// 見積・明細・原価・事業者情報・案件ごとの粗利の zod スキーマ(WO-011 段階3・docs/SPEC-v2.md §3.4・§3.5・§3.11・§4)。
// case.ts と同じ使い方:
//   ①フォーム/Server Actions への入力 … *InputSchema で検証してから DB に渡す
//   ②Supabase から読んだ値 … *RowSchema で検証してから使う(`as` によるキャストはしない)
//
// 金額の決まり(D94):
//   - 明細の単価・金額は税抜の整数円。小計(税抜)・税・合計(税込)は DB が明細から計算して保存する。
//     画面から合計を渡す入力は作らない(渡されても DB が上書きするが、そもそも受け取らない)。
//   - 値引きは、画面では正の金額で入れてもらい、保存のときに符号を反転する(DB は値引きの単価 ≤ 0 を要求する)。
//   - 原価は税抜の整数円。

export const ESTIMATE_STATUSES = ["下書き", "提出済", "採用", "不採用"] as const;
export const ESTIMATE_CATEGORIES = ["施工費", "商品代", "経費", "値引き"] as const;
export const COST_CATEGORIES = ["外注費", "材料費", "経費"] as const;
export const TAX_RATES = [10, 8, 0] as const;
export const REVENUE_BASES = ["請求", "見込み", "内訳なし", "未定"] as const;

/** 単位の候補(自由入力もできる。SPEC-v2 §3.4) */
export const UNIT_SUGGESTIONS = ["㎡", "m", "式", "個", "箇所", "人工", "枚", "本", "台", "日"] as const;

const MAX_YEN = 1_000_000_000; // 10億円。integer(約21億)に収まる上限(合計の足し算でも溢れない)
const MAX_QUANTITY = 99_999_999.99; // numeric(10,2)

// ── DB 行の検証スキーマ(読み取り時) ──────────────────────────────────────────

export const estimateRowSchema = z.object({
  id: z.string().uuid(),
  case_id: z.string().uuid(),
  estimate_no: z.string(),
  version: z.coerce.number().int(),
  copied_from_id: z.string().uuid().nullable(),
  status: z.enum(ESTIMATE_STATUSES),
  issue_date: z.string().nullable(),
  valid_until: z.string().nullable(),
  tax_rate_pct: z.coerce.number().int(),
  subtotal_yen: z.coerce.number().int(),
  tax_yen: z.coerce.number().int(),
  total_yen: z.coerce.number().int(),
  note: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type EstimateRow = z.infer<typeof estimateRowSchema>;

export const estimateItemRowSchema = z.object({
  id: z.string().uuid(),
  estimate_id: z.string().uuid(),
  sort_order: z.coerce.number().int(),
  category: z.enum(ESTIMATE_CATEGORIES),
  description: z.string(),
  quantity: z.coerce.number(),
  unit: z.string().nullable(),
  unit_price_yen: z.coerce.number().int(),
  amount_yen: z.coerce.number().int(),
  copied_from_item_id: z.string().uuid().nullable(),
  is_deleted: z.boolean(),
});
export type EstimateItemRow = z.infer<typeof estimateItemRowSchema>;

export const costRowSchema = z.object({
  id: z.string().uuid(),
  case_id: z.string().uuid(),
  category: z.enum(COST_CATEGORIES),
  description: z.string(),
  amount_yen: z.coerce.number().int(),
  cost_date: z.string(),
  memo: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CostRow = z.infer<typeof costRowSchema>;

export const businessProfileRowSchema = z.object({
  id: z.string().uuid(),
  shop_name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  invoice_reg_no: z.string().nullable(),
  bank_info: z.string().nullable(),
  updated_at: z.string(),
});
export type BusinessProfileRow = z.infer<typeof businessProfileRowSchema>;

/** case_financials ビュー(案件ごとの粗利の契約)の1行。粗利は税抜(D94-1) */
export const caseFinancialsRowSchema = z.object({
  case_id: z.string().uuid(),
  adopted_estimate_id: z.string().uuid().nullable(),
  adopted_estimate_no: z.string().nullable(),
  adopted_estimate_version: z.coerce.number().int().nullable(),
  adopted_subtotal_yen: z.coerce.number().int().nullable(),
  adopted_total_yen: z.coerce.number().int().nullable(),
  invoice_count: z.coerce.number().int(),
  invoices_without_estimate: z.coerce.number().int(),
  invoiced_subtotal_yen: z.coerce.number().int().nullable(),
  cost_total_yen: z.coerce.number().int(),
  revenue_basis: z.enum(REVENUE_BASES),
  revenue_yen: z.coerce.number().int().nullable(),
  gross_profit_yen: z.coerce.number().int().nullable(),
});
export type CaseFinancialsRow = z.infer<typeof caseFinancialsRowSchema>;

// ── フォーム/Server Actions の入力検証 ───────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付は YYYY-MM-DD 形式で入力してください");
const optionalText = (max: number) => z.string().trim().max(max, `${max}字までです`).optional();

/** 明細1行。単価は「正の金額」で受け取る(値引きの符号は保存のときに反転する) */
export const estimateItemInputSchema = z.object({
  id: z.string().uuid().optional(),
  category: z.enum(ESTIMATE_CATEGORIES),
  description: z.string().trim().min(1, "内容を入力してください").max(200, "内容は200字までです"),
  quantity: z
    .number({ invalid_type_error: "数量を入力してください" })
    .gt(0, "数量は0より大きい値にしてください")
    .max(MAX_QUANTITY, "数量が大きすぎます")
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "数量は小数第2位までです"),
  unit: optionalText(20),
  unitPrice: z
    .number({ invalid_type_error: "単価を入力してください" })
    .int("単価は整数の円で入力してください")
    .min(0, "単価は0以上で入力してください(値引きも正の金額で入れてください)")
    .max(MAX_YEN, "単価が大きすぎます"),
  copiedFromItemId: z.string().uuid().optional(),
});
export type EstimateItemInput = z.infer<typeof estimateItemInputSchema>;

/** 見積の明細の保存(下書きのときだけ。DB が下書きかどうかを確かめる)。税率・備考・有効期限も一緒に */
export const saveEstimateInputSchema = z.object({
  estimateId: z.string().uuid(),
  taxRatePct: z.union([z.literal(10), z.literal(8), z.literal(0)]),
  note: optionalText(1000),
  validUntil: isoDate.optional().or(z.literal("")),
  items: z.array(estimateItemInputSchema).max(200, "明細は200行までです"),
});
export type SaveEstimateInput = z.infer<typeof saveEstimateInputSchema>;

export const createEstimateInputSchema = z.object({ caseId: z.string().uuid() });

/** 状態の変更。移れる先は DB が決める(下書き→提出済、提出済→採用/不採用、採用/不採用→提出済) */
export const changeEstimateStatusInputSchema = z.object({
  estimateId: z.string().uuid(),
  status: z.enum(["提出済", "採用", "不採用"]),
});
export type ChangeEstimateStatusInput = z.infer<typeof changeEstimateStatusInputSchema>;

export const estimateIdInputSchema = z.object({ estimateId: z.string().uuid() });

/** 前回の見積の明細を写す(写す元の値は DB 関数が読む。ここでは id だけを受け取る) */
export const copyEstimateItemsInputSchema = z.object({
  estimateId: z.string().uuid(),
  sourceItemIds: z.array(z.string().uuid()).min(1, "写す明細を選んでください").max(200),
});
export type CopyEstimateItemsInput = z.infer<typeof copyEstimateItemsInputSchema>;

/** 見積から請求を作る。金額と税率は DB が見積から写す(ここでは受け取らない) */
export const createInvoiceFromEstimateInputSchema = z.object({
  estimateId: z.string().uuid(),
  issueDate: isoDate.optional().or(z.literal("")),
  formatPattern: optionalText(200),
  memo: optionalText(2000),
});
export type CreateInvoiceFromEstimateInput = z.infer<typeof createInvoiceFromEstimateInputSchema>;

/** 原価。金額は税抜の整数円。外注先は屋号までにし、個人名は書かない */
export const createCostInputSchema = z.object({
  caseId: z.string().uuid(),
  category: z.enum(COST_CATEGORIES),
  description: z.string().trim().min(1, "内容を入力してください").max(200, "内容は200字までです"),
  amountYen: z
    .number({ invalid_type_error: "金額を入力してください" })
    .int("金額は整数の円で入力してください")
    .min(0, "金額は0以上で入力してください")
    .max(MAX_YEN, "金額が大きすぎます"),
  costDate: isoDate,
  memo: optionalText(500),
});
export type CreateCostInput = z.infer<typeof createCostInputSchema>;

export const updateCostInputSchema = createCostInputSchema.omit({ caseId: true }).extend({ costId: z.string().uuid() });
export type UpdateCostInput = z.infer<typeof updateCostInputSchema>;

export const costDeletedInputSchema = z.object({ costId: z.string().uuid(), isDeleted: z.boolean() });

/** 事業者情報(1行だけ)。登録番号は T + 数字13桁、または空(未登録・免税) */
export const businessProfileInputSchema = z.object({
  shopName: z.string().trim().min(1, "屋号を入力してください").max(100, "屋号は100字までです"),
  address: optionalText(200),
  phone: optionalText(30),
  invoiceRegNo: z
    .string()
    .trim()
    .regex(/^(T\d{13})?$/, "登録番号は T と数字13桁で入力してください(登録していなければ空にしてください)")
    .optional(),
  bankInfo: optionalText(300),
});
export type BusinessProfileInput = z.infer<typeof businessProfileInputSchema>;

/** 税率から税額を出す(画面の「試算」用。保存される値は DB が計算する。0 方向の切り捨て・D94-9) */
export function calcTaxYen(subtotalYen: number, taxRatePct: number): number {
  return Math.trunc((subtotalYen * taxRatePct) / 100);
}

/** 明細の金額の試算(画面の即時表示用。保存される値は DB が計算する)。0 方向の切り捨て */
export function calcItemAmountYen(quantity: number, unitPriceYen: number): number {
  // 小数の誤差(2.675 など)で 1 円ずれないよう、数量を 1/100 単位の整数にしてから掛ける
  return Math.trunc((Math.round(quantity * 100) * unitPriceYen) / 100);
}
