import { z } from "zod";

// 物件(buildings)・部屋(units)の zod スキーマ(WO-011 段階1・docs/SPEC-v2.md §3.1・§3.2)。
// site.ts と同じ使い方:
//   ①フォーム/Server Actions への入力 … *InputSchema で検証してから DB に渡す
//   ②Supabase から読んだ値 … *RowSchema で検証してから使う(`as` によるキャストはしない)
//
// 入居者名・発注元の担当者名の列は作らない(poc-app/CLAUDE.md §2)。
// lat / lng / geo_source は列として持つが、段階1 では入力欄を作らない(D80)。

export const BUILDING_KINDS = ["集合住宅", "戸建て", "店舗・事務所", "その他"] as const;
export const GEO_SOURCES = ["住所検索", "地図で指定", "旧データ"] as const;

// ── DB 行の検証スキーマ(読み取り時) ──────────────────────────────────────────

export const buildingRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(BUILDING_KINDS),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  geo_source: z.enum(GEO_SOURCES).nullable(),
  default_client_id: z.string().uuid().nullable(),
  memo: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type BuildingRow = z.infer<typeof buildingRowSchema>;

export const unitRowSchema = z.object({
  id: z.string().uuid(),
  building_id: z.string().uuid(),
  room_no: z.string().nullable(),
  legacy_site_id: z.string().uuid().nullable(),
  memo: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type UnitRow = z.infer<typeof unitRowSchema>;

/** building_overview ビュー(物件の一覧の契約)の1行 */
export const buildingOverviewRowSchema = z.object({
  building_id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(BUILDING_KINDS),
  address: z.string().nullable(),
  memo: z.string().nullable(),
  default_client_id: z.string().uuid().nullable(),
  default_client_name: z.string().nullable(),
  unit_count: z.coerce.number().int(),
  job_count: z.coerce.number().int(),
  last_job_date: z.string().nullable(),
});
export type BuildingOverviewRow = z.infer<typeof buildingOverviewRowSchema>;

// ── フォーム/Server Actions の入力検証 ───────────────────────────────────────

/** 部屋番号の入力(「203, 305」「203 305」「203、305」)を、重複を除いた配列にする */
export function parseRoomNumbers(raw: string): string[] {
  const rooms = raw
    .split(/[,、，\s]+/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  return [...new Set(rooms)];
}

const buildingFields = {
  name: z.string().trim().min(1, "物件名を入力してください").max(200, "物件名が長すぎます"),
  kind: z.enum(BUILDING_KINDS),
  address: z.string().trim().max(300, "住所が長すぎます").optional(),
  defaultClientId: z.string().uuid().nullable().optional(),
  memo: z.string().max(2000, "メモが長すぎます").optional(),
};

export const buildingInputSchema = z.object({
  ...buildingFields,
  /** 登録時に作る部屋の番号(空なら部屋を作らない) */
  rooms: z
    .array(z.string().trim().min(1).max(50, "部屋番号が長すぎます"))
    .max(200, "一度に登録できる部屋は200までです"),
});
export type BuildingInput = z.infer<typeof buildingInputSchema>;

export const updateBuildingInputSchema = z.object({
  id: z.string().uuid(),
  ...buildingFields,
});
export type UpdateBuildingInput = z.infer<typeof updateBuildingInputSchema>;

export const addUnitsInputSchema = z.object({
  buildingId: z.string().uuid(),
  rooms: z
    .array(z.string().trim().min(1).max(50, "部屋番号が長すぎます"))
    .min(1, "部屋番号を入力してください")
    .max(200, "一度に登録できる部屋は200までです"),
});
export type AddUnitsInput = z.infer<typeof addUnitsInputSchema>;

/**
 * 検索語(物件名・住所・メモ・部屋番号の部分一致)。ilike のワイルドカード(% _)と \ は
 * リテラルとして扱うため、DB に渡す前にエスケープする(文字列連結の .or() は使わない)。
 */
export const buildingSearchInputSchema = z
  .string()
  .trim()
  .min(1, "検索語を入力してください")
  .max(50, "50字までで検索できます")
  .transform((q) => q.replace(/[\\%_]/g, (c) => `\\${c}`));

/** 一覧の絞り込み(URL のクエリから来る値。信用せず検証する) */
export const buildingFilterSchema = z.object({
  q: z.string().optional(),
  kind: z.enum(BUILDING_KINDS).optional(),
  client: z.string().uuid().optional(),
});
export type BuildingFilter = z.infer<typeof buildingFilterSchema>;

export const buildingDeletedInputSchema = z.object({
  buildingId: z.string().uuid(),
  isDeleted: z.boolean(),
});
export type BuildingDeletedInput = z.infer<typeof buildingDeletedInputSchema>;

export const unitDeletedInputSchema = z.object({
  unitId: z.string().uuid(),
  isDeleted: z.boolean(),
});
export type UnitDeletedInput = z.infer<typeof unitDeletedInputSchema>;
