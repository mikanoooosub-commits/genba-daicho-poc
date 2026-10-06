"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InvoiceForm } from "@/components/ledger/invoice-form";
import { PaymentList } from "@/components/ledger/payment-list";
import { DeleteReasonDialog } from "@/components/ledger/delete-reason-dialog";
import { AuditLogDialog, type AuditFieldLabel } from "@/components/ledger/audit-log-dialog";
import { getInvoiceByIdAction, setInvoiceDeletedAction, updateInvoiceAction } from "@/lib/data/actions-ledger";
import { PAYMENT_STATUS_META, type Invoice, type InvoiceLedgerRow } from "@/lib/types";
import { formatDate, formatYen } from "@/lib/format";

/** deleted-invoice-item.tsx でも使う(取消済み請求の変更履歴にも同じ項目を表示する) */
export const INVOICE_FIELDS: AuditFieldLabel[] = [
  { key: "amount", label: "金額", fmt: (v) => (typeof v === "number" ? formatYen(v) : String(v ?? "—")) },
  { key: "format_pattern", label: "様式", fmt: (v) => (v ? String(v) : "—") },
  { key: "issue_date", label: "発行日", fmt: (v) => (v ? formatDate(String(v)) : "—") },
  { key: "memo", label: "メモ", fmt: (v) => (v ? String(v) : "—") },
  { key: "is_deleted", label: "状態", fmt: (v) => (v ? "取消済み" : "有効") },
];

/**
 * 請求1件分のカード(台帳画面・現場詳細の両方から使う)。
 * 入金明細は展開時に PaymentList が自前で取得する(N+1回避のため一覧側では先読みしない)。
 */
export function InvoiceItem({
  row,
  onChanged,
  showBuildingName = true,
  showDeletedPayments = false,
}: {
  row: InvoiceLedgerRow;
  onChanged?: () => void;
  /** 現場詳細パネルなど、現場が自明な文脈では建物名を再掲しない */
  showBuildingName?: boolean;
  /** true のとき、展開した入金明細に取消済み(is_deleted=true)の入金も表示する(ISSUE-007) */
  showDeletedPayments?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const status = PAYMENT_STATUS_META[row.payment_status];

  async function openEdit() {
    setLoadingEdit(true);
    try {
      setEditInvoice(await getInvoiceByIdAction(row.invoice_id));
    } finally {
      setLoadingEdit(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {showBuildingName && <p className="font-bold">{row.building_name}</p>}
            <p className="text-xs text-muted-foreground">
              {row.client_name}（{row.client_type}）・{row.lead_source}
            </p>
            <p className="text-xs text-muted-foreground">
              発行日 {row.issue_date ? formatDate(row.issue_date) : "未設定"}
              {row.format_pattern ? ` ・様式: ${row.format_pattern}` : ""}
            </p>
          </div>
          <Badge className={status.badgeClass}>{status.label}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>
            請求 <span className="font-bold tabular-nums">{formatYen(row.amount)}</span>
          </span>
          <span>
            入金 <span className="font-bold tabular-nums">{formatYen(row.paid_amount)}</span>
          </span>
          <span>
            未入金{" "}
            <span className="font-bold tabular-nums">{formatYen(row.amount - row.paid_amount)}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
          <Dialog
            open={editOpen}
            onOpenChange={(o) => {
              setEditOpen(o);
              if (o) openEdit();
            }}
          >
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5">
                <Pencil className="size-4" />
                編集
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85dvh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>請求を編集</DialogTitle>
              </DialogHeader>
              {loadingEdit || !editInvoice ? (
                <p className="py-6 text-center text-sm text-muted-foreground">読み込み中…</p>
              ) : (
                <InvoiceForm
                  fixedSiteId={row.site_id}
                  fixedSiteLabel={row.building_name}
                  initial={{
                    id: editInvoice.id,
                    siteId: editInvoice.site_id,
                    amount: editInvoice.amount,
                    formatPattern: editInvoice.format_pattern,
                    issueDate: editInvoice.issue_date,
                    memo: editInvoice.memo,
                  }}
                  amountLocked={editInvoice.estimate_id !== null}
                  submitLabel="保存する"
                  onSubmit={updateInvoiceAction}
                  onSuccess={() => {
                    setEditOpen(false);
                    onChanged?.();
                  }}
                  onCancel={() => setEditOpen(false)}
                />
              )}
            </DialogContent>
          </Dialog>

          <AuditLogDialog entityType="invoices" entityId={row.invoice_id} fields={INVOICE_FIELDS} />

          <DeleteReasonDialog
            title="この請求を取り消しますか"
            description="紐づく入金の記録は残りますが、台帳の集計から請求が外れます。理由は変更履歴に残ります。"
            onConfirm={(reason) =>
              setInvoiceDeletedAction({ invoiceId: row.invoice_id, isDeleted: true, reason })
            }
            onDone={onChanged}
          />

          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5 text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            入金明細
          </Button>
        </div>

        {expanded && <PaymentList invoiceId={row.invoice_id} showDeleted={showDeletedPayments} />}
      </CardContent>
    </Card>
  );
}
