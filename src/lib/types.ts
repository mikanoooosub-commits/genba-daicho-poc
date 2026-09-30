import {
  CLIENT_TYPES,
  LEAD_SOURCES,
  type ClientRow,
  type SiteRow,
  type JobRow,
  type SiteStatusRow,
} from "@/lib/validation/site";

// ── 評価 ───────────────────────────────────────────────────────────────────
export type Rating = "good" | "normal" | "bad";

export const RATING_META: Record<
  Rating,
  { label: string; colorVar: string; badgeClass: string }
> = {
  good: { label: "良好", colorVar: "var(--rating-good)", badgeClass: "bg-rating-good text-white" },
  normal: { label: "普通", colorVar: "var(--rating-normal)", badgeClass: "bg-rating-normal text-white" },
  bad: { label: "非推奨", colorVar: "var(--rating-bad)", badgeClass: "bg-rating-bad text-white" },
};

export const RATING_ORDER: Rating[] = ["good", "normal", "bad"];

// ── DB テーブルに対応する型 ─────────────────────────────────────────────────
export type School = {
  id: string;
  name: string;
  url: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
};

export type Location = {
  id: string;
  school_id: string | null;
  spot: string | null;
  label: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
};

export type Visit = {
  id: string;
  location_id: string;
  user_id: string | null;
  date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM[:SS]
  end_time: string | null;
  count: number | null;
  rating: Rating;
  memo: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

export type VisitAction = "create" | "update" | "delete";

export type VisitLog = {
  id: string;
  visit_id: string;
  user_id: string | null;
  action: VisitAction;
  before_data: Visit | null;
  after_data: Visit | null;
  created_at: string;
};

export type VisitLogWithUser = VisitLog & { userName: string | null };

export type LocationPinStatus = {
  location_id: string;
  latest_visit_id: string | null;
  latest_rating: Rating | null;
  latest_date: string | null;
  latest_start_time: string | null;
};

// ── 画面表示用に join した型 ─────────────────────────────────────────────────
export type VisitWithRelations = Visit & {
  location: (Location & { school: School | null }) | null;
};

// ── マップメモ ───────────────────────────────────────────────────────────────
export type MapNote = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  label: string | null;
  memo: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string;
};

/** メモの色プリセット（色自体に意味は持たせない。用途は見出し・メモで自由に） */
export const NOTE_PRESETS: { value: string; label: string; color: string }[] = [
  { value: "yellow", label: "黄", color: "#eab308" },
  { value: "purple", label: "紫", color: "#8b5cf6" },
  { value: "red", label: "赤", color: "#ef4444" },
  { value: "blue", label: "青", color: "#3b82f6" },
  { value: "green", label: "緑", color: "#22c55e" },
];

export const NOTE_COLOR_MAP: Record<string, string> = Object.fromEntries(
  NOTE_PRESETS.map((p) => [p.value, p.color])
);

export function noteColor(token: string): string {
  return NOTE_COLOR_MAP[token] ?? "#eab308";
}

// ── フォーム入力・アクション結果 ─────────────────────────────────────────────
export type VisitInput = {
  /** 既存の配布場所を選んだ場合はその id。新規作成なら null（schoolId+spot から解決） */
  locationId: string | null;
  schoolId: string;
  spot: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  count: number | null;
  rating: Rating;
  memo: string | null;
  lat: number | null;
  lng: number | null;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

// ── P-A″ 現場を軸にした台帳(地図つき) ─────────────────────────────────────────
// 実装Bが担当する型(請求・入金・台帳・集計)だけをここに追記する(SPEC.md §11)。
// 実装Aの型(Client/ClientType/Site/LeadSource/Job/JobRating/SiteStatus)は
// 実装A担当ファイルでこのセクションに追記される想定。相手の型はここでは定義・変更しない。
//
// 注意: client_type / lead_source は invoice_ledger ビュー由来の文字列としてここでは
// string 型のまま扱う(実装Aが ClientType/LeadSource の union 型を定義したら、
// そちらに合わせて絞り込むことを検討する。PMに判断を求める点、参照)。

export type ReconciliationStatus = "unmatched" | "matched" | "disputed";

export const RECONCILIATION_STATUS_META: Record<ReconciliationStatus, { label: string }> = {
  unmatched: { label: "未照合" },
  matched: { label: "照合済" },
  disputed: { label: "不一致" },
};

export type Invoice = {
  id: string;
  site_id: string;
  amount: number;
  format_pattern: string | null;
  issue_date: string | null; // YYYY-MM-DD
  memo: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

export type Payment = {
  id: string;
  invoice_id: string;
  payment_date: string; // YYYY-MM-DD
  amount: number;
  reconciliation_status: ReconciliationStatus;
  memo: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

export type PaymentStatus = "未入金" | "一部入金" | "入金済";

export const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; badgeClass: string }> = {
  未入金: { label: "未入金", badgeClass: "bg-rating-bad text-white" },
  一部入金: { label: "一部入金", badgeClass: "bg-rating-normal text-white" },
  入金済: { label: "入金済", badgeClass: "bg-rating-good text-white" },
};

/** invoice_ledger ビュー(公開契約。SPEC.md §4-3)の1行。台帳画面・集計の元データ */
export type InvoiceLedgerRow = {
  invoice_id: string;
  site_id: string;
  building_name: string;
  client_id: string;
  client_name: string;
  client_type: string;
  lead_source: string;
  amount: number;
  format_pattern: string | null;
  issue_date: string | null;
  issue_month: string | null; // YYYY-MM-01(月初日)
  paid_amount: number;
  payment_status: PaymentStatus;
};

/** 発注元別・集客経路別・月次いずれかの軸での集計1行分 */
export type LedgerSummaryRow = {
  key: string;
  label: string;
  count: number;
  invoicedTotal: number;
  paidTotal: number;
  unpaidTotal: number;
};

export type LedgerSummary = {
  byClient: LedgerSummaryRow[];
  byLeadSource: LedgerSummaryRow[];
  byMonth: LedgerSummaryRow[];
  overall: { count: number; invoicedTotal: number; paidTotal: number; unpaidTotal: number };
};

// ── 監査ログ(jobs/invoices/payments 共通。entity_type で対象を区別) ───────────
// audit_logs は3エンティティ共通のテーブルのため、実装A(jobs)からも参照されうる。
// 型自体は汎用なのでここに置くが、書き換えるときは実装Aに一声かける(SPEC.md §11方針)。

export type AuditLogEntityType = "jobs" | "invoices" | "payments";
export type AuditLogAction = "create" | "update" | "delete";

export type AuditLog = {
  id: string;
  entity_type: AuditLogEntityType;
  entity_id: string;
  user_id: string | null;
  action: AuditLogAction;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};

export type AuditLogWithUser = AuditLog & { userName: string | null };

// ── ここから実装A追加分(発注元・現場・施工・地図) ────────────────────────────
// 型の実体はDB行の形をそのままzodで検証した結果(src/lib/validation/site.ts)。
// 他ファイルからは常に `@/lib/types` を参照する(共通CLAUDE.md「型定義は1か所に集約」)。
// 実装Bの型(このファイル上部のセクション)は書き換えない。

export type ClientType = (typeof CLIENT_TYPES)[number];
export const CLIENT_TYPE_ORDER: ClientType[] = [...CLIENT_TYPES];

export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_ORDER: LeadSource[] = [...LEAD_SOURCES];

/** 集客経路のラベル(値自体が日本語のため恒等写像。表示側の参照を1箇所に集約する目的) */
export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  本部紹介: "本部紹介",
  自前チラシ: "自前チラシ",
  管理会社: "管理会社",
  紹介: "紹介",
  マッチング: "マッチング",
  その他: "その他",
};

export type Client = ClientRow;
export type Site = SiteRow;

/** 施工の仕上がり評価。既存の Rating(good/normal/bad)と値の集合が同じため型を再利用する。 */
export type JobRating = Rating;
export const JOB_RATING_META = RATING_META;
export const JOB_RATING_ORDER = RATING_ORDER;

export type Job = JobRow;

export type SiteStatusValue = "未請求" | "請求済_未入金" | "入金済";

/** 地図ピンの色(PM決定 D38・SPEC.md §12-8。design-tokens.mdの値と同じ) */
export const SITE_STATUS_META: Record<SiteStatusValue, { label: string; color: string }> = {
  未請求: { label: "未請求", color: "#889694" },
  請求済_未入金: { label: "請求済・未入金", color: "#C1752F" },
  入金済: { label: "入金済", color: "#2C7A4B" },
};

export type SiteStatus = SiteStatusRow;
