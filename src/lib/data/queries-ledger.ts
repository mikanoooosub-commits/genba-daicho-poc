import { createClient } from "@/lib/supabase/server";
import type { Invoice, InvoiceLedgerRow, LedgerSummary, LedgerSummaryRow, Payment } from "@/lib/types";
import {
  clientOptionRowSchema,
  invoiceLedgerRowSchema,
  invoiceRowSchema,
  paymentRowSchema,
  parseOrThrow,
  siteOptionRowSchema,
} from "@/lib/validation/invoice";
import { z } from "zod";

// サーバーコンポーネントから呼ぶ読み取り関数群("use server" は付けない。既存 queries.ts と同じ方針)。
// `select *` は使わない。Supabase から読んだ値は zod で検証してから返す(`as` キャストは使わない)。

const INVOICE_LEDGER_COLUMNS =
  "invoice_id, site_id, building_name, client_id, client_name, client_type, lead_source, amount, format_pattern, issue_date, issue_month, paid_amount, payment_status";

const INVOICE_COLUMNS =
  "id, site_id, amount, format_pattern, issue_date, memo, is_deleted, created_at, updated_at";

const PAYMENT_COLUMNS =
  "id, invoice_id, payment_date, amount, reconciliation_status, memo, is_deleted, created_at, updated_at";

export type InvoiceLedgerFilters = {
  clientId?: string;
  leadSource?: string;
  siteId?: string;
  month?: string; // YYYY-MM
  /** 未入金候補のみ(payment_status <> '入金済') */
  unpaidOnly?: boolean;
};

/** "YYYY-MM" → 翌月の "YYYY-MM-01"(排他的な上限として使う) */
function nextMonthStart(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

/** 台帳画面(③)・現場詳細の請求一覧が使う唯一の取得経路(invoice_ledger ビューのみを select する) */
export async function getInvoiceLedger(filters: InvoiceLedgerFilters = {}): Promise<InvoiceLedgerRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("invoice_ledger")
    .select(INVOICE_LEDGER_COLUMNS)
    .order("issue_date", { ascending: false, nullsFirst: false });

  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.leadSource) query = query.eq("lead_source", filters.leadSource);
  if (filters.siteId) query = query.eq("site_id", filters.siteId);
  if (filters.month) {
    query = query.gte("issue_month", `${filters.month}-01`).lt("issue_month", nextMonthStart(filters.month));
  }
  if (filters.unpaidOnly) query = query.neq("payment_status", "入金済");

  const { data, error } = await query;
  if (error) throw error;

  return parseOrThrow(z.array(invoiceLedgerRowSchema), data ?? [], "invoice_ledger");
}

function monthLabel(issueMonth: string | null): string {
  if (!issueMonth) return NO_MONTH_LABEL;
  return issueMonth.slice(0, 7); // "YYYY-MM-01" → "YYYY-MM"
}

const NO_MONTH_LABEL = "(月未設定)";

/** 月次表の並び: 新しい月が上("YYYY-MM" の降順)、月未設定は末尾 */
function compareMonthDesc(a: LedgerSummaryRow, b: LedgerSummaryRow): number {
  if (a.key === NO_MONTH_LABEL) return b.key === NO_MONTH_LABEL ? 0 : 1;
  if (b.key === NO_MONTH_LABEL) return -1;
  return b.key.localeCompare(a.key);
}

function groupSum(
  rows: InvoiceLedgerRow[],
  keyOf: (r: InvoiceLedgerRow) => string,
  labelOf: (r: InvoiceLedgerRow) => string
): LedgerSummaryRow[] {
  const map = new Map<string, LedgerSummaryRow>();
  for (const r of rows) {
    const key = keyOf(r);
    const row = map.get(key) ?? {
      key,
      label: labelOf(r),
      count: 0,
      invoicedTotal: 0,
      paidTotal: 0,
      unpaidTotal: 0,
    };
    row.count += 1;
    row.invoicedTotal += r.amount;
    row.paidTotal += r.paid_amount;
    row.unpaidTotal = row.invoicedTotal - row.paidTotal;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.invoicedTotal - a.invoicedTotal);
}

/**
 * 発注元別・集客経路別・月次の集計(SPEC.md §6)。
 * 件数が少ないPoC前提のため、専用の集計ビューは増やさずアプリ側(JS)で group by する。
 */
export function summarizeInvoiceLedger(rows: InvoiceLedgerRow[]): LedgerSummary {
  const byClient = groupSum(rows, (r) => r.client_id, (r) => r.client_name);
  const byLeadSource = groupSum(rows, (r) => r.lead_source, (r) => r.lead_source);
  const byMonth = groupSum(rows, (r) => monthLabel(r.issue_month), (r) => monthLabel(r.issue_month)).sort(
    compareMonthDesc
  );

  const overall = rows.reduce(
    (acc, r) => {
      acc.count += 1;
      acc.invoicedTotal += r.amount;
      acc.paidTotal += r.paid_amount;
      return acc;
    },
    { count: 0, invoicedTotal: 0, paidTotal: 0 }
  );

  return {
    byClient,
    byLeadSource,
    byMonth,
    overall: { ...overall, unpaidTotal: overall.invoicedTotal - overall.paidTotal },
  };
}

/** 現場詳細(実装A担当画面)の請求一覧・台帳の編集フォーム初期値に使う、請求の実テーブル取得 */
export async function getInvoiceById(id: string): Promise<Invoice | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").select(INVOICE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return parseOrThrow(invoiceRowSchema, data, "invoices");
}

/**
 * 1請求に紐づく入金一覧(分割入金対応)。
 * `options.includeDeleted` が true のときは論理削除済み(is_deleted=true)の入金も含めて返す
 * (ISSUE-007対応。取消済み入金の追跡用。省略時は従来どおり有効な入金のみ)。
 */
export async function getPaymentsForInvoice(
  invoiceId: string,
  options: { includeDeleted?: boolean } = {}
): Promise<Payment[]> {
  const supabase = await createClient();
  let query = supabase.from("payments").select(PAYMENT_COLUMNS).eq("invoice_id", invoiceId);
  if (!options.includeDeleted) query = query.eq("is_deleted", false);
  query = query
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return parseOrThrow(z.array(paymentRowSchema), data ?? [], "payments");
}

/**
 * 取消済み(is_deleted=true)の請求一覧(ISSUE-007対応)。
 * `invoice_ledger` ビューは `where i.is_deleted = false` 固定(db-change原則: ビューを契約に)
 * のため取消済みは取得できない。台帳の集計対象には含めない表示専用の経路として、
 * `invoices` テーブルを直接、列を列挙して読む(`select *` 禁止)。
 * `filters.siteId` を渡すと現場詳細パネル(その現場分のみ)に絞り込める。
 */
export async function getDeletedInvoices(filters: { siteId?: string } = {}): Promise<Invoice[]> {
  const supabase = await createClient();
  let query = supabase.from("invoices").select(INVOICE_COLUMNS).eq("is_deleted", true);
  if (filters.siteId) query = query.eq("site_id", filters.siteId);
  query = query
    .order("issue_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return parseOrThrow(z.array(invoiceRowSchema), data ?? [], "invoices(is_deleted=true)");
}

/**
 * 台帳フィルタのプルダウン用、発注元の簡易一覧(id・nameのみ)。
 * clients テーブルの作成・編集は実装A担当だが、参照のみここで行う
 * (SPEC.md §11: 実装A担当ファイルには触れない、の対象は actions-sites/queries-sites/
 * validation/site/sites** であり、本ファイルからの読み取り専用参照は含まない)。
 */
export async function getClientOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .eq("is_deleted", false)
    .order("name");
  if (error) throw error;
  return parseOrThrow(z.array(clientOptionRowSchema), data ?? [], "clients(id,name)");
}

/**
 * 台帳画面から新規請求を作るときの現場プルダウン用、簡易一覧(id・建物名・発注元idのみ)。
 * sites テーブルの作成・編集は実装A担当だが、参照のみここで行う(理由は getClientOptions と同じ)。
 */
export async function getSiteOptions(): Promise<
  { id: string; building_name: string; room_no: string | null; client_id: string }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, building_name, room_no, client_id")
    .eq("is_deleted", false)
    .order("building_name")
    .order("room_no");
  if (error) throw error;
  return parseOrThrow(z.array(siteOptionRowSchema), data ?? [], "sites(id,building_name,room_no,client_id)");
}
