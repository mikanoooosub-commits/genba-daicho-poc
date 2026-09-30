"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RECONCILIATION_STATUS_META, type ActionResult, type ReconciliationStatus } from "@/lib/types";
import { todayISO } from "@/lib/format";

const RECONCILIATION_ORDER: ReconciliationStatus[] = ["unmatched", "matched", "disputed"];

type PaymentFormValues = {
  id?: string;
  invoiceId: string;
  paymentDate: string;
  amount: number;
  reconciliationStatus: ReconciliationStatus;
  memo: string | null;
};

type Props = {
  invoiceId: string;
  initial?: Partial<PaymentFormValues>;
  submitLabel: string;
  onSubmit: (input: unknown) => Promise<ActionResult>;
  onSuccess?: () => void;
  onCancel?: () => void;
};

export function PaymentForm({ invoiceId, initial, submitLabel, onSubmit, onSuccess, onCancel }: Props) {
  const [paymentDate, setPaymentDate] = useState(initial?.paymentDate ?? todayISO());
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [reconciliationStatus, setReconciliationStatus] = useState<ReconciliationStatus>(
    initial?.reconciliationStatus ?? "unmatched"
  );
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!paymentDate) {
      setError("入金日を入力してください");
      return;
    }
    const amountNumber = Number(amount);
    if (amount.trim() === "" || Number.isNaN(amountNumber) || amountNumber < 0) {
      setError("金額は0以上の数値で入力してください");
      return;
    }

    const payload = {
      ...(initial?.id ? { id: initial.id } : {}),
      invoiceId,
      paymentDate,
      amount: amountNumber,
      reconciliationStatus,
      memo: memo.trim() || null,
    };

    startTransition(async () => {
      const result = await onSubmit(payload);
      if (result.ok) onSuccess?.();
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="pf-date">入金日</Label>
        <Input
          id="pf-date"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="pf-amount">入金額</Label>
        <Input
          id="pf-amount"
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="金額（円）"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">
          分割入金の場合は、入金のたびにこのフォームから追加してください（1件ずつ複数回登録可）。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="pf-status">照合状態</Label>
        <Select
          value={reconciliationStatus}
          onValueChange={(v) => setReconciliationStatus(v as ReconciliationStatus)}
        >
          <SelectTrigger id="pf-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECONCILIATION_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {RECONCILIATION_STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="pf-memo">メモ</Label>
        <Textarea
          id="pf-memo"
          placeholder="通帳の摘要など"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            キャンセル
          </Button>
        )}
        <Button type="submit" disabled={pending} className="flex-1">
          {pending ? "保存中…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
