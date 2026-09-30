"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { InvoiceItem } from "@/components/ledger/invoice-item";
import { DeletedInvoiceItem } from "@/components/ledger/deleted-invoice-item";
import { getDeletedInvoicesAction } from "@/lib/data/actions-ledger";
import type { Invoice, InvoiceLedgerRow } from "@/lib/types";

/**
 * SiteInvoicesPanel(サーバーコンポーネント)から、router.refresh を使うためだけの薄いクライアント境界
 * ……に加えて、「取消済みを表示」チェックボックス(ISSUE-007)もここで持つ。
 *
 * `sites/[id]/page.tsx` は実装A担当ファイルのため、施工(jobs)の「削除済みを表示」のような
 * URL(`?deleted=1`)+Server Component再取得の方式は使えない(そのページに手を入れられない)。
 * 代わりに `PaymentList` の入金明細と同じ「クライアント側でオンデマンド取得」の設計に合わせ、
 * チェックを入れたときだけ `getDeletedInvoicesAction({ siteId })` を呼ぶ。
 */
export function SiteInvoiceList({ siteId, rows }: { siteId: string; rows: InvoiceLedgerRow[] }) {
  const router = useRouter();
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedInvoices, setDeletedInvoices] = useState<Invoice[] | null>(null);
  const [loadingDeleted, setLoadingDeleted] = useState(false);

  const loadDeleted = useCallback(async () => {
    setLoadingDeleted(true);
    try {
      setDeletedInvoices(await getDeletedInvoicesAction({ siteId }));
    } finally {
      setLoadingDeleted(false);
    }
  }, [siteId]);

  function handleToggle(checked: boolean) {
    setShowDeleted(checked);
    if (checked && deletedInvoices === null && !loadingDeleted) {
      loadDeleted();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={showDeleted}
          onChange={(e) => handleToggle(e.target.checked)}
        />
        取消済みを表示
      </label>

      {rows.map((r) => (
        <InvoiceItem
          key={r.invoice_id}
          row={r}
          showBuildingName={false}
          showDeletedPayments={showDeleted}
          onChanged={() => router.refresh()}
        />
      ))}

      {showDeleted && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold text-muted-foreground">
            取消済み請求（{deletedInvoices?.length ?? 0}件）
          </h3>
          {loadingDeleted && (
            <p className="text-xs text-muted-foreground">読み込み中…</p>
          )}
          {!loadingDeleted && deletedInvoices !== null && deletedInvoices.length === 0 && (
            <Card>
              <CardContent className="py-4 text-center text-xs text-muted-foreground">
                取消済みの請求はありません
              </CardContent>
            </Card>
          )}
          {!loadingDeleted &&
            deletedInvoices !== null &&
            deletedInvoices.map((inv) => <DeletedInvoiceItem key={inv.id} invoice={inv} />)}
        </div>
      )}
    </div>
  );
}
