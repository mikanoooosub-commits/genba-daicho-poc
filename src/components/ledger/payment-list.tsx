"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PaymentForm } from "@/components/ledger/payment-form";
import { DeleteReasonDialog } from "@/components/ledger/delete-reason-dialog";
import { AuditLogDialog, type AuditFieldLabel } from "@/components/ledger/audit-log-dialog";
import {
  createPaymentAction,
  getPaymentsForInvoiceAction,
  setPaymentDeletedAction,
  updatePaymentAction,
} from "@/lib/data/actions-ledger";
import { RECONCILIATION_STATUS_META, type Payment, type ReconciliationStatus } from "@/lib/types";
import { formatDate, formatYen } from "@/lib/format";

/**
 * 監査ログの before_data/after_data(jsonb)は unknown で来るため、`as` によるキャストではなく
 * 型ガードで絞り込む(poc-app/CLAUDE.md「`as`によるキャストは禁止」)。
 */
function isReconciliationStatus(v: unknown): v is ReconciliationStatus {
  return typeof v === "string" && v in RECONCILIATION_STATUS_META;
}

const PAYMENT_FIELDS: AuditFieldLabel[] = [
  { key: "payment_date", label: "入金日", fmt: (v) => (v ? formatDate(String(v)) : "—") },
  { key: "amount", label: "金額", fmt: (v) => (typeof v === "number" ? formatYen(v) : String(v ?? "—")) },
  {
    key: "reconciliation_status",
    label: "照合状態",
    fmt: (v) => (isReconciliationStatus(v) ? RECONCILIATION_STATUS_META[v].label : String(v ?? "—")),
  },
  { key: "memo", label: "メモ", fmt: (v) => (v ? String(v) : "—") },
  { key: "is_deleted", label: "状態", fmt: (v) => (v ? "取消済み" : "有効") },
];

/**
 * 1請求分の入金明細。台帳画面・現場詳細の請求カードから展開して使う。
 * ISSUE-007対応: `showDeleted` が true のとき取消済み(is_deleted=true)の入金も取得して
 * 灰色+「取消済み」バッジで表示する(取消済みの入金には編集・取消ボタンを出さない。
 * 復元機能は今回の対象外)。`readOnly` は取消済み請求の明細を参照専用で見せる用途
 * (「入金を追加」ボタン自体を出さない)。
 */
export function PaymentList({
  invoiceId,
  showDeleted = false,
  readOnly = false,
}: {
  invoiceId: string;
  showDeleted?: boolean;
  readOnly?: boolean;
}) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPayments(await getPaymentsForInvoiceAction(invoiceId, { includeDeleted: showDeleted }));
    } finally {
      setLoading(false);
    }
  }, [invoiceId, showDeleted]);

  useEffect(() => {
    reload();
  }, [reload]);

  const editingPayment = payments?.find((p) => p.id === editingId) ?? null;

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-muted-foreground">入金明細</p>
        {!readOnly && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5">
                <Plus className="size-3.5" />
                入金を追加
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>入金を登録</DialogTitle>
              </DialogHeader>
              <PaymentForm
                invoiceId={invoiceId}
                submitLabel="登録する"
                onSubmit={createPaymentAction}
                onSuccess={() => {
                  setAddOpen(false);
                  reload();
                }}
                onCancel={() => setAddOpen(false)}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {loading && <p className="text-xs text-muted-foreground">読み込み中…</p>}
      {!loading && payments && payments.length === 0 && (
        <p className="text-xs text-muted-foreground">入金の記録はまだありません</p>
      )}
      {!loading && payments && payments.length > 0 && (
        <ul className="flex flex-col gap-2">
          {payments.map((p) => (
            <li
              key={p.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-card px-3 py-2 text-sm ${
                p.is_deleted ? "opacity-60" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="font-bold">
                  {formatYen(p.amount)}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {formatDate(p.payment_date)}
                  </span>
                </p>
                {p.memo && <p className="whitespace-pre-wrap text-xs text-muted-foreground">{p.memo}</p>}
              </div>
              <div className="flex items-center gap-0.5">
                <Badge variant="outline">{RECONCILIATION_STATUS_META[p.reconciliation_status].label}</Badge>
                {p.is_deleted && (
                  <Badge variant="outline" className="text-destructive">
                    取消済み
                  </Badge>
                )}
                {!readOnly && !p.is_deleted && (
                  <Dialog open={editingId === p.id} onOpenChange={(o) => setEditingId(o ? p.id : null)}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-8" aria-label="入金を編集">
                        <Pencil className="size-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>入金を編集</DialogTitle>
                      </DialogHeader>
                      {editingPayment && (
                        <PaymentForm
                          invoiceId={invoiceId}
                          initial={{
                            id: editingPayment.id,
                            paymentDate: editingPayment.payment_date,
                            amount: editingPayment.amount,
                            reconciliationStatus: editingPayment.reconciliation_status,
                            memo: editingPayment.memo,
                          }}
                          submitLabel="保存する"
                          onSubmit={updatePaymentAction}
                          onSuccess={() => {
                            setEditingId(null);
                            reload();
                          }}
                          onCancel={() => setEditingId(null)}
                        />
                      )}
                    </DialogContent>
                  </Dialog>
                )}
                <AuditLogDialog
                  entityType="payments"
                  entityId={p.id}
                  fields={PAYMENT_FIELDS}
                  triggerLabel=""
                />
                {!readOnly && !p.is_deleted && (
                  <DeleteReasonDialog
                    title="この入金を取り消しますか"
                    description="取り消すと入金額の集計から除外されます（マイナス行は使いません）。理由は変更履歴に残ります。"
                    triggerLabel=""
                    onConfirm={(reason) =>
                      setPaymentDeletedAction({ paymentId: p.id, isDeleted: true, reason })
                    }
                    onDone={reload}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
