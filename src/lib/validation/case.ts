import { z } from "zod";

import { LEAD_SOURCES } from "@/lib/validation/site";

// 案件(cases)の zod スキーマ(WO-011 段階2・docs/SPEC-v2.md §3.3・§3.9)。
// building.ts と同じ使い方:
//   ①フォーム/Server Actions への入力 … *InputSchema で検証してから DB に渡す
//   ②Supabase から読んだ値 … *RowSchema で検証してから使う(`as` によるキャストはしない)
//
// 入居者名・発注元の担当者名の列は作らない(poc-app/CLAUDE.md §2)。
// 状態は、人が動かす6つを cases.status に持つ。請求済・入金済は請求と入金から計算する
// (case_overview.display_status。SPEC-v2 §3.3)。

/** 人が動かす6つ(cases.status) */
export const CASE_STATUSES = ["依頼", "見積中", "受注", "施工中", "完了", "失注"] as const;
/** 一覧に出す8つ(display_status)。流れの順 */
export const CASE_DISPLAY_STATUSES = ["依頼", "見積中", "受注", "施工中", "完了", "請求済", "入金済", "失注"] as const;
export const WORK_KINDS = ["原状回復", "リフォーム", "クリーニング", "修繕", "その他"] as const;

// ── DB 行の検証スキーマ(読み取り時) ──────────────────────────────────────────

export const caseRowSchema = z.object({
  id: z.string().uuid(),
  case_no: z.string(),
  building_id: z.string().uuid(),
  unit_id: z.string().uuid().nullable(),
  site_id: z.string().uuid(),
  client_id: z.string().uuid(),
  lead_source: z.enum(LEAD_SOURCES),
  work_kind: z.enum(WORK_KINDS),
  received_on: z.string(),
  request_summary: z.string().nullable(),
  status: z.enum(CASE_STATUSES),
  lost_reason: z.string().nullable(),
  memo: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CaseRow = z.infer<typeof caseRowSchema>;

/** case_overview ビュー(案件の一覧の契約)の1行。金額は v1 の invoices.amount(numeric。旧データは税込とみなす) */
export const caseOverviewRowSchema = z.object({
  case_id: z.string().uuid(),
  case_no: z.string(),
  building_id: z.string().uuid(),
  building_name: z.string(),
  unit_id: z.string().uuid().nullable(),
  room_no: z.string().nullable(),
  client_id: z.string().uuid(),
  client_name: z.string(),
  lead_source: z.enum(LEAD_SOURCES),
  work_kind: z.enum(WORK_KINDS),
  received_on: z.string(),
  request_summary: z.string().nullable(),
  status: z.enum(CASE_STATUSES),
  display_status: z.enum(CASE_DISPLAY_STATUSES),
  job_count: z.coerce.number().int(),
  last_job_date: z.string().nullable(),
  invoice_count: z.coerce.number().int(),
  invoiced_total: z.coerce.number(),
  paid_total: z.coerce.number(),
  unpaid_total: z.coerce.number(),
  needs_invoice: z.boolean(),
  is_migrated: z.boolean(),
  site_id: z.string().uuid(),
  created_at: z.string(),
});
export type CaseOverviewRow = z.infer<typeof caseOverviewRowSchema>;

// ── フォーム/Server Actions の入力検証 ───────────────────────────────────────

const roomNo = z.string().trim().min(1).max(50, "部屋番号が長すぎます");

/**
 * 案件の登録。物件は「既にある物件(buildingId)」か「その場で登録する新しい物件(newBuildingName)」の
 * どちらか1つ。部屋は「既にある部屋(unitId)」か「その場で足す番号(newRoomNo)」か、無し(物件全体)。
 */
export const createCaseInputSchema = z
  .object({
    buildingId: z.string().uuid().optional(),
    newBuildingName: z.string().trim().min(1, "物件名を入力してください").max(200, "物件名が長すぎます").optional(),
    newBuildingKind: z.enum(["集合住宅", "戸建て", "店舗・事務所", "その他"]).optional(),
    unitId: z.string().uuid().optional(),
    newRoomNo: roomNo.optional(),
    clientId: z.string().uuid({ message: "発注元を選んでください" }),
    workKind: z.enum(WORK_KINDS),
    leadSource: z.enum(LEAD_SOURCES).optional(),
    requestSummary: z.string().trim().max(200, "依頼の内容は200字までです").optional(),
  })
  .refine((v) => Boolean(v.buildingId) !== Boolean(v.newBuildingName), {
    message: "物件を選ぶか、新しい物件の名前を入れてください",
    path: ["buildingId"],
  })
  .refine((v) => !(v.unitId && v.newRoomNo), {
    message: "部屋は、選ぶか番号を入れるかのどちらかにしてください",
    path: ["unitId"],
  })
  .refine((v) => !(v.newBuildingName && v.unitId), {
    message: "新しい物件には、既にある部屋を選べません",
    path: ["unitId"],
  });
export type CreateCaseInput = z.infer<typeof createCaseInputSchema>;

/** 案件の編集。物件・部屋は変えない(変えたいときは取り消して登録し直す) */
export const updateCaseInputSchema = z.object({
  caseId: z.string().uuid(),
  clientId: z.string().uuid({ message: "発注元を選んでください" }),
  workKind: z.enum(WORK_KINDS),
  leadSource: z.enum(LEAD_SOURCES),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "受付日を入力してください"),
  requestSummary: z.string().trim().max(200, "依頼の内容は200字までです").optional(),
});
export type UpdateCaseInput = z.infer<typeof updateCaseInputSchema>;

export const changeCaseStatusInputSchema = z.object({
  caseId: z.string().uuid(),
  status: z.enum(CASE_STATUSES),
  lostReason: z.string().trim().max(200, "理由は200字までです").optional(),
});
export type ChangeCaseStatusInput = z.infer<typeof changeCaseStatusInputSchema>;

export const caseDeletedInputSchema = z.object({
  caseId: z.string().uuid(),
  isDeleted: z.boolean(),
});
export type CaseDeletedInput = z.infer<typeof caseDeletedInputSchema>;

/** 一覧の語句検索(案件番号・物件名・部屋番号・依頼の内容)。ilike のワイルドカードはエスケープする */
export const caseSearchInputSchema = z
  .string()
  .trim()
  .min(1, "検索語を入力してください")
  .max(50, "50字までで検索できます")
  .transform((q) => q.replace(/[\\%_]/g, (c) => `\\${c}`));

/** 一覧の絞り込み(URL のクエリから来る値。信用せず検証する) */
export const caseFilterSchema = z.object({
  q: z.string().optional(),
  status: z.enum(CASE_DISPLAY_STATUSES).optional(),
  client: z.string().uuid().optional(),
  attention: z.literal("needs_invoice").optional(),
});
export type CaseFilter = z.infer<typeof caseFilterSchema>;

/** 新しい案件の入口で使う、物件と部屋の候補 */
export const caseBuildingOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.string(),
  default_client_id: z.string().uuid().nullable(),
});
export type CaseBuildingOption = z.infer<typeof caseBuildingOptionSchema>;

export const caseUnitOptionSchema = z.object({
  id: z.string().uuid(),
  building_id: z.string().uuid(),
  room_no: z.string().nullable(),
});
export type CaseUnitOption = z.infer<typeof caseUnitOptionSchema>;
