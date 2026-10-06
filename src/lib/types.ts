import {
  BUILDING_KINDS,
  GEO_SOURCES,
  type BuildingRow,
  type UnitRow,
  type BuildingOverviewRow,
} from "@/lib/validation/building";
import {
  CASE_DISPLAY_STATUSES,
  CASE_STATUSES,
  WORK_KINDS,
  type CaseOverviewRow,
  type CaseRow,
} from "@/lib/validation/case";
import {
  COST_CATEGORIES,
  ESTIMATE_CATEGORIES,
  ESTIMATE_STATUSES,
  REVENUE_BASES,
  type BusinessProfileRow,
  type CaseFinancialsRow,
  type CostRow,
  type EstimateItemRow,
  type EstimateRow,
} from "@/lib/validation/estimate";
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

// ── フォーム入力・アクション結果 ─────────────────────────────────────────────
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
  /** 見積から作った請求のとき、その見積(金額・税率は DB が固定する) */
  estimate_id: string | null;
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

export type AuditLogEntityType =
  | "jobs"
  | "invoices"
  | "payments"
  | "sites"
  | "clients"
  | "buildings"
  | "units"
  | "cases";
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

// ── v2: 物件と部屋(WO-011 段階1・docs/SPEC-v2.md §3.1・§3.2) ─────────────────────
// 型の実体は DB 行の形をそのまま zod で検証した結果(src/lib/validation/building.ts)。

export type BuildingKind = (typeof BUILDING_KINDS)[number];
export const BUILDING_KIND_ORDER: BuildingKind[] = [...BUILDING_KINDS];

export type GeoSource = (typeof GEO_SOURCES)[number];

export type Building = BuildingRow;
export type Unit = UnitRow;
/** building_overview ビュー(物件の一覧の契約)の1行 */
export type BuildingOverview = BuildingOverviewRow;

// ── v2: 案件(WO-011 段階2・docs/SPEC-v2.md §3.3・§3.9) ─────────────────────────
// 型の実体は DB 行の形をそのまま zod で検証した結果(src/lib/validation/case.ts)。

export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_STATUS_ORDER: CaseStatus[] = [...CASE_STATUSES];
/** 一覧に出す8つ(人が動かす6つ+請求済・入金済)。流れの順 */
export type CaseDisplayStatus = (typeof CASE_DISPLAY_STATUSES)[number];
export const CASE_DISPLAY_STATUS_ORDER: CaseDisplayStatus[] = [...CASE_DISPLAY_STATUSES];
export type WorkKind = (typeof WORK_KINDS)[number];
export const WORK_KIND_ORDER: WorkKind[] = [...WORK_KINDS];

export type Case = CaseRow;
/** case_overview ビュー(案件の一覧の契約)の1行 */
export type CaseOverview = CaseOverviewRow;

// ── v2: 見積・明細・原価・事業者情報・粗利(WO-011 段階3・docs/SPEC-v2.md §3.4・§3.5・§3.11) ──
// 型の実体は DB 行の形をそのまま zod で検証した結果(src/lib/validation/estimate.ts)。
// 金額はすべて整数の円。見積の小計(税抜)・税・合計(税込)は DB が明細から計算して保存する。

export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];
export type EstimateCategory = (typeof ESTIMATE_CATEGORIES)[number];
export type CostCategory = (typeof COST_CATEGORIES)[number];
/** 粗利の売上の根拠: 請求 / 見込み(採用した見積)/ 内訳なし(見積に結びつかない請求がある)/ 未定 */
export type RevenueBasis = (typeof REVENUE_BASES)[number];

export type Estimate = EstimateRow;
export type EstimateItem = EstimateItemRow;
export type Cost = CostRow;
export type BusinessProfile = BusinessProfileRow;
/** case_financials ビュー(案件ごとの粗利。税抜)の1行 */
export type CaseFinancials = CaseFinancialsRow;

