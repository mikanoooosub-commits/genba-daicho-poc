import { z } from "zod";

// このPoC(現場を軸にした台帳)のzodスキーマ。実装Aの担当範囲(発注元・現場・施工)のみ。
// 請求・入金は `src/lib/validation/invoice.ts`(実装B)に分離する(SPEC.md §11)。
//
// 共通CLAUDE.md方針により、ここのスキーマを2箇所で使う。
//   ①フォーム/Server Actionsへの入力: `*InputSchema` で検証してからDBに渡す
//   ②Supabaseから読んだ値: `*RowSchema` で検証してから使う(`as`によるキャストはしない)

export const CLIENT_TYPES = ["管理会社", "FC本部", "マッチング", "紹介", "その他"] as const;
export const LEAD_SOURCES = [
  "本部紹介",
  "自前チラシ",
  "管理会社",
  "紹介",
  "マッチング",
  "その他",
] as const;
export const JOB_RATINGS = ["good", "normal", "bad"] as const;
export const SITE_STATUS_VALUES = ["未請求", "請求済_未入金", "入金済"] as const;

// ── DB行の検証スキーマ(読み取り時に使う) ────────────────────────────────────

export const clientRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(CLIENT_TYPES),
  format_memo: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ClientRow = z.infer<typeof clientRowSchema>;

export const siteRowSchema = z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  building_name: z.string(),
  room_no: z.string().nullable(),
  address_memo: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  lead_source: z.enum(LEAD_SOURCES),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SiteRow = z.infer<typeof siteRowSchema>;

/** sites + 埋め込みの clients(発注元)。queries-sites.ts の getSites/getSiteById で使う */
export const siteWithClientRowSchema = siteRowSchema.extend({
  client: clientRowSchema.nullable(),
});
export type SiteWithClientRow = z.infer<typeof siteWithClientRowSchema>;

export const jobRowSchema = z.object({
  id: z.string().uuid(),
  site_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  job_date: z.string(),
  work_type: z.string().nullable(),
  content: z.string().nullable(),
  assignee_name: z.string().nullable(),
  photo_urls: z.array(z.string()),
  rating: z.enum(JOB_RATINGS),
  memo: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type JobRow = z.infer<typeof jobRowSchema>;

/** 「前回施工」の要約に使う列だけ(吹き出し・同じ建物の他の部屋) */
export const latestJobRowSchema = jobRowSchema.pick({
  site_id: true,
  job_date: true,
  work_type: true,
  content: true,
});
export type LatestJob = z.infer<typeof latestJobRowSchema>;

// site_status ビューの total_invoiced/total_paid は Postgres の numeric 型。
// PostgREST は通常これを JSON number で返すが、未確認(Supabase実機で要確認)のため
// z.coerce.number() で文字列で返ってきた場合にも耐えるようにしておく。
export const siteStatusRowSchema = z.object({
  site_id: z.string().uuid(),
  latest_job_date: z.string().nullable(),
  latest_rating: z.enum(JOB_RATINGS).nullable(),
  total_invoiced: z.coerce.number(),
  total_paid: z.coerce.number(),
  status: z.enum(SITE_STATUS_VALUES),
});
export type SiteStatusRow = z.infer<typeof siteStatusRowSchema>;

// ── フォーム/Server Actionsの入力検証スキーマ ───────────────────────────────

export const clientInputSchema = z.object({
  name: z.string().trim().min(1, "発注元名を入力してください").max(200, "発注元名が長すぎます"),
  type: z.enum(CLIENT_TYPES),
  formatMemo: z.string().max(2000, "様式メモが長すぎます").optional(),
});
export type ClientInput = z.infer<typeof clientInputSchema>;

export const updateClientInputSchema = clientInputSchema.extend({
  id: z.string().uuid(),
});
export type UpdateClientInput = z.infer<typeof updateClientInputSchema>;

export const clientDeletedInputSchema = z.object({
  clientId: z.string().uuid(),
  isDeleted: z.boolean(),
});
export type ClientDeletedInput = z.infer<typeof clientDeletedInputSchema>;

export const siteInputSchema = z.object({
  clientId: z.string().uuid({ message: "発注元を選択してください" }),
  buildingName: z.string().trim().min(1, "建物名を入力してください").max(200, "建物名が長すぎます"),
  roomNo: z.string().max(50, "部屋番号が長すぎます").optional(),
  addressMemo: z.string().max(500, "住所メモが長すぎます").optional(),
  lat: z.number().finite().nullable().optional(),
  lng: z.number().finite().nullable().optional(),
  leadSource: z.enum(LEAD_SOURCES),
});
export type SiteInput = z.infer<typeof siteInputSchema>;

export const updateSiteInputSchema = siteInputSchema.extend({
  id: z.string().uuid(),
});
export type UpdateSiteInput = z.infer<typeof updateSiteInputSchema>;

export const siteDeletedInputSchema = z.object({
  siteId: z.string().uuid(),
  isDeleted: z.boolean(),
});
export type SiteDeletedInput = z.infer<typeof siteDeletedInputSchema>;

/** 現場検索(建物名・住所メモ・部屋番号の部分一致)。ilike のワイルドカード(% _)と \ は
 *  リテラルとして扱うため、DBに渡す前にエスケープする(文字列連結の .or() は使わない: PM指示) */
export const siteSearchInputSchema = z
  .string()
  .trim()
  .min(1, "検索語を入力してください")
  .max(50, "50字までで検索できます")
  .transform((q) => q.replace(/[\\%_]/g, (c) => `\\${c}`));

export const jobInputSchema = z.object({
  siteId: z.string().uuid(),
  jobDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "施工日を入力してください"),
  workType: z.string().max(100, "工種が長すぎます").optional(),
  content: z.string().max(2000, "施工内容が長すぎます").optional(),
  assigneeName: z.string().max(100, "担当名が長すぎます").optional(),
  photoUrls: z.array(z.string().trim().url("写真URLの形式が正しくありません")).max(20, "写真は20件までです"),
  rating: z.enum(JOB_RATINGS),
  memo: z.string().max(2000, "メモが長すぎます").optional(),
});
export type JobInput = z.infer<typeof jobInputSchema>;

export const updateJobInputSchema = jobInputSchema.extend({
  id: z.string().uuid(),
});
export type UpdateJobInput = z.infer<typeof updateJobInputSchema>;

export const jobDeletedInputSchema = z.object({
  jobId: z.string().uuid(),
  isDeleted: z.boolean(),
});
export type JobDeletedInput = z.infer<typeof jobDeletedInputSchema>;
