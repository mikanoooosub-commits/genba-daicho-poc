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
import type { ActionResult } from "@/lib/types";
import { todayISO } from "@/lib/format";

export type SiteOption = { id: string; building_name: string; room_no: string | null; client_id: string };

/** 請求の登録で現場を選ぶときの表示。同じ建物の別の部屋を区別できるよう、部屋番号をつける(D86-3) */
export function siteOptionLabel(s: Pick<SiteOption, "building_name" | "room_no">): string {
  return s.room_no ? `${s.building_name} ${s.room_no}` : s.building_name;
}

type InvoiceFormValues = {
  id?: string;
  siteId: string;
  amount: number;
  formatPattern: string | null;
  issueDate: string | null;
  memo: string | null;
};

type Props = {
  /** 台帳画面(現場を横断)から新規作成するときに選ばせる現場候補 */
  siteOptions?: SiteOption[];
  /** 現場詳細から追加するときは現場を固定し、選択UIを出さない */
  fixedSiteId?: string;
  fixedSiteLabel?: string;
  initial?: Partial<InvoiceFormValues>;
  /** 見積から作った請求は、金額を直せない(DB が固定する)。欄を無効にして理由を出す */
  amountLocked?: boolean;
  submitLabel: string;
  onSubmit: (input: unknown) => Promise<ActionResult>;
  onSuccess?: () => void;
  onCancel?: () => void;
};

export function InvoiceForm({
  siteOptions,
  fixedSiteId,
  fixedSiteLabel,
  initial,
  amountLocked = false,
  submitLabel,
  onSubmit,
  onSuccess,
  onCancel,
}: Props) {
  const [siteId, setSiteId] = useState(fixedSiteId ?? initial?.siteId ?? "");
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : "");
  const [formatPattern, setFormatPattern] = useState(initial?.formatPattern ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? todayISO());
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!siteId) {
      setError("現場を選択してください");
      return;
    }
    const amountNumber = Number(amount);
    if (amount.trim() === "" || Number.isNaN(amountNumber) || amountNumber < 0) {
      setError("金額は0以上の数値で入力してください");
      return;
    }

    const payload = {
      ...(initial?.id ? { id: initial.id } : {}),
      siteId,
      amount: amountNumber,
      formatPattern: formatPattern.trim() || null,
      issueDate: issueDate || null,
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
        <Label htmlFor="if-site">現場</Label>
        {fixedSiteId ? (
          <p className="rounded-xl border-2 border-border bg-muted/40 px-4 py-2 text-sm">
            {fixedSiteLabel ?? "(選択済みの現場)"}
          </p>
        ) : (
          <Select value={siteId} onValueChange={setSiteId}>
            <SelectTrigger id="if-site">
              <SelectValue placeholder="現場を選択" />
            </SelectTrigger>
            <SelectContent>
              {(siteOptions ?? []).length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  現場が登録されていません
                </div>
              ) : (
                siteOptions?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {siteOptionLabel(s)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="if-amount">請求金額</Label>
        <Input
          id="if-amount"
          type="number"
          inputMode="numeric"
          min={0}
          placeholder="金額（円）"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          disabled={amountLocked}
          aria-describedby={amountLocked ? "if-amount-locked" : undefined}
        />
        {amountLocked && (
          <p id="if-amount-locked" className="text-sm text-muted-foreground">
            見積から作った請求の金額・税率は直せません。直すときは、見積を出し直します。
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="if-format">様式パターン</Label>
        <Input
          id="if-format"
          placeholder="例: 管理会社Aの雛形"
          value={formatPattern}
          onChange={(e) => setFormatPattern(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="if-date">発行日</Label>
        <Input
          id="if-date"
          type="date"
          value={issueDate ?? ""}
          onChange={(e) => setIssueDate(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="if-memo">メモ</Label>
        <Textarea
          id="if-memo"
          placeholder="請求内容の補足など"
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
