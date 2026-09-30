"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, Filter, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InvoiceForm, type SiteOption } from "@/components/ledger/invoice-form";
import { InvoiceItem } from "@/components/ledger/invoice-item";
import { DeletedInvoiceItem } from "@/components/ledger/deleted-invoice-item";
import { createInvoiceAction } from "@/lib/data/actions-ledger";
import { LEAD_SOURCE_ORDER, type Invoice, type InvoiceLedgerRow, type LedgerSummary } from "@/lib/types";
import { formatDatePadded, formatYen, formatYearMonth } from "@/lib/format";

/** 台帳一覧を「税理士・本部へ渡す用」にタブ区切りテキストへ整形する */
function buildLedgerTsv(rows: InvoiceLedgerRow[]): string {
  const header = ["発行日", "建物", "発注元", "集客経路", "様式", "請求金額", "入金額", "未入金額", "状態"].join(
    "\t"
  );
  const body = rows.map((r) =>
    [
      r.issue_date ? formatDatePadded(r.issue_date) : "",
      r.building_name,
      r.client_name,
      r.lead_source,
      r.format_pattern ?? "",
      String(r.amount),
      String(r.paid_amount),
      String(r.amount - r.paid_amount),
      r.payment_status,
    ].join("\t")
  );
  return [header, ...body].join("\n");
}

export type LedgerFilters = {
  clientId: string;
  leadSource: string;
  month: string; // YYYY-MM
};

type Props = {
  rows: InvoiceLedgerRow[];
  summary: LedgerSummary;
  clientOptions: { id: string; name: string }[];
  siteOptions: SiteOption[];
  filters: LedgerFilters;
  /** URLの `?deleted=1` に対応(ISSUE-007)。true のとき下の `deletedInvoices` が意味を持つ */
  includeDeleted: boolean;
  /** 取消済み(is_deleted=true)の請求一覧。`includeDeleted=false` のときは常に空配列 */
  deletedInvoices: Invoice[];
};

export function LedgerView({
  rows,
  summary,
  clientOptions,
  siteOptions,
  filters,
  includeDeleted,
  deletedInvoices,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const unpaidRows = useMemo(() => rows.filter((r) => r.payment_status !== "入金済"), [rows]);

  // 取消済み請求は building_name/client_name を持たない(invoices テーブルを直接読むため。
  // ISSUE-007対応)。台帳の絞り込み用に既に取得済みの siteOptions/clientOptions から解決する。
  const siteById = useMemo(() => new Map(siteOptions.map((s) => [s.id, s])), [siteOptions]);
  const clientNameById = useMemo(() => new Map(clientOptions.map((c) => [c.id, c.name])), [clientOptions]);

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
    router.push(`/ledger?${params.toString()}`);
  }

  function clearFilters() {
    router.push("/ledger");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildLedgerTsv(rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボード権限が無い環境では何もしない
    }
  }

  const hasActiveFilter = filters.clientId || filters.leadSource || filters.month;

  function toggleIncludeDeleted(checked: boolean) {
    updateParam("deleted", checked ? "1" : null);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 新規請求登録 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogTrigger asChild>
          <Button size="lg" className="w-full gap-2">
            <Plus className="size-5" />
            請求を登録
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>請求を登録</DialogTitle>
          </DialogHeader>
          <InvoiceForm
            siteOptions={siteOptions}
            submitLabel="登録する"
            onSubmit={createInvoiceAction}
            onSuccess={() => {
              setAddOpen(false);
              router.refresh();
            }}
            onCancel={() => setAddOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* フィルタ */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <Filter className="size-4" />
              絞り込み
            </span>
            {hasActiveFilter && (
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={clearFilters}>
                <X className="size-3.5" />
                クリア
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lf-client" className="text-xs">発注元</Label>
            <Select
              value={filters.clientId || "all"}
              onValueChange={(v) => updateParam("client", v === "all" ? null : v)}
            >
              <SelectTrigger id="lf-client">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                {clientOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lf-lead" className="text-xs">集客経路</Label>
            <Select
              value={filters.leadSource || "all"}
              onValueChange={(v) => updateParam("lead", v === "all" ? null : v)}
            >
              <SelectTrigger id="lf-lead">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                {LEAD_SOURCE_ORDER.map((ls) => (
                  <SelectItem key={ls} value={ls}>
                    {ls}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lf-month" className="text-xs">月(発行月)</Label>
            <Input
              id="lf-month"
              type="month"
              value={filters.month}
              onChange={(e) => updateParam("month", e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={includeDeleted}
              onChange={(e) => toggleIncludeDeleted(e.target.checked)}
            />
            取消済みを表示
          </label>
        </CardContent>
      </Card>

      {/* 月次の締め用サマリー */}
      <SummarySection summary={summary} />

      {/* 未入金候補 */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">未入金候補({unpaidRows.length}件)</h2>
        {unpaidRows.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              未入金の請求はありません
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {unpaidRows.map((r) => (
              <InvoiceItem
                key={r.invoice_id}
                row={r}
                onChanged={() => router.refresh()}
                showDeletedPayments={includeDeleted}
              />
            ))}
          </div>
        )}
      </div>

      {/* コピー(税理士・本部へ渡す用) */}
      {rows.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopy}>
            {copied ? <Check className="size-4 text-rating-good" /> : <Copy className="size-4" />}
            {copied ? "コピーしました" : "台帳をコピー（税理士・本部用）"}
          </Button>
        </div>
      )}

      {/* 全件一覧 */}
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-bold">請求一覧（{rows.length}件）</h2>
        {rows.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {hasActiveFilter ? "条件に合う請求がありません" : "まだ請求が登録されていません"}
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <InvoiceItem
                key={r.invoice_id}
                row={r}
                onChanged={() => router.refresh()}
                showDeletedPayments={includeDeleted}
              />
            ))}
          </div>
        )}
      </div>

      {/* 取消済み請求(ISSUE-007)。集計には含めない表示専用 */}
      {includeDeleted && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-bold">取消済み請求（{deletedInvoices.length}件）</h2>
          {deletedInvoices.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                取消済みの請求はありません
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {deletedInvoices.map((inv) => {
                const site = siteById.get(inv.site_id);
                const clientName = site ? clientNameById.get(site.client_id) : undefined;
                return (
                  <DeletedInvoiceItem
                    key={inv.id}
                    invoice={inv}
                    buildingName={site?.building_name}
                    clientLabel={clientName}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummarySection({ summary }: { summary: LedgerSummary }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-2">
          <SummaryCell label="請求合計" value={formatYen(summary.overall.invoicedTotal)} />
          <SummaryCell label="入金合計" value={formatYen(summary.overall.paidTotal)} />
          <SummaryCell label="未入金合計" value={formatYen(summary.overall.unpaidTotal)} />
        </div>

        <SummaryGroup title="発注元別" rows={summary.byClient} />
        <SummaryGroup title="集客経路別" rows={summary.byLeadSource} />
        <SummaryGroup
          title="月次"
          rows={summary.byMonth.map((r) => ({ ...r, label: formatYearMonth(r.label) }))}
        />
      </CardContent>
    </Card>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 text-center shadow-sm">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

function SummaryGroup({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; count: number; invoicedTotal: number; paidTotal: number; unpaidTotal: number }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-bold text-muted-foreground">{title}</p>
      <div className="overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-bold">区分</th>
              <th className="px-2 py-1.5 text-right font-bold">件数</th>
              <th className="px-2 py-1.5 text-right font-bold">請求</th>
              <th className="px-2 py-1.5 text-right font-bold">入金</th>
              <th className="px-2 py-1.5 text-right font-bold">未入金</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border/40">
                <td className="px-2 py-1.5">{r.label}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.count}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(r.invoicedTotal)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(r.paidTotal)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(r.unpaidTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
