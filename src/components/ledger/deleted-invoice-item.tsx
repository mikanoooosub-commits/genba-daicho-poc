"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AuditLogDialog } from "@/components/ledger/audit-log-dialog";
import { INVOICE_FIELDS } from "@/components/ledger/invoice-item";
import { PaymentList } from "@/components/ledger/payment-list";
import type { Invoice } from "@/lib/types";
import { formatDate, formatYen } from "@/lib/format";

/**
 * 取消済み(is_deleted=true)の請求1件分のカード(ISSUE-007対応)。
 * 台帳画面・現場詳細パネルの「取消済みを表示」チェックボックスがONのときだけ表示する。
 * 表示専用: 編集・復元ボタンは持たない(復元は判断を伴うため今回のスコープ外。
 * PM依頼の指示どおり)。「変更履歴」から取消理由入りの監査ログを確認できる。
 */
export function DeletedInvoiceItem({
  invoice,
  buildingName,
  clientLabel,
}: {
  invoice: Invoice;
  /** 台帳画面など現場が自明でない文脈でだけ渡す(現場詳細パネルでは省略してよい) */
  buildingName?: string;
  clientLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="opacity-60">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {buildingName && <p className="font-bold">{buildingName}</p>}
            {clientLabel && <p className="text-xs text-muted-foreground">{clientLabel}</p>}
            <p className="text-xs text-muted-foreground">
              発行日 {invoice.issue_date ? formatDate(invoice.issue_date) : "未設定"}
              {invoice.format_pattern ? ` ・様式: ${invoice.format_pattern}` : ""}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 text-destructive">
            取消済み
          </Badge>
        </div>

        <p className="text-sm">
          請求 <span className="font-bold tabular-nums">{formatYen(invoice.amount)}</span>
        </p>

        {invoice.memo && (
          <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-xs text-muted-foreground">
            {invoice.memo}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
          <AuditLogDialog entityType="invoices" entityId={invoice.id} fields={INVOICE_FIELDS} />

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

        {/* 取消済み請求の入金明細は参照専用(追加・編集・取消不可)。取消済み入金も併せて見せる */}
        {expanded && <PaymentList invoiceId={invoice.id} showDeleted readOnly />}
      </CardContent>
    </Card>
  );
}
