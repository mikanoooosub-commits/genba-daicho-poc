import { Plus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { getInvoiceLedger } from "@/lib/data/queries-ledger";
import { SiteInvoiceAddButton } from "@/components/ledger/site-invoice-add-button";
import { SiteInvoiceList } from "@/components/ledger/site-invoice-list";

/**
 * 現場詳細画面(実装A担当・`src/app/(main)/sites/[id]/page.tsx`)に差し込む
 * 「請求・入金」コンポーネント(SPEC.md §11)。
 *
 * 使い方: 実装Aの現場詳細ページから `<SiteInvoicesPanel siteId={site.id} buildingName={site.building_name} />`
 * を呼ぶだけでよい。データ取得(invoice_ledger ビュー)はこのコンポーネント自身が行うため、
 * 実装A側で請求・入金のクエリを書く必要はない(実装A/Bのファイル分担を守るための設計。
 * SPEC.md §11「実装Aが担当するファイルには触れない」の裏返しとして、実装Bの領域は
 * このように自己完結にした)。
 */
export async function SiteInvoicesPanel({
  siteId,
  buildingName,
}: {
  siteId: string;
  buildingName: string;
}) {
  const rows = await getInvoiceLedger({ siteId });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">請求・入金</h2>
        <SiteInvoiceAddButton siteId={siteId} buildingName={buildingName} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Plus className="size-5" />
            まだこの現場の請求はありません
          </CardContent>
        </Card>
      ) : null}

      {/*
        取消済み請求(ISSUE-007)は SiteInvoiceList 側でオンデマンド取得する
        (`sites/[id]/page.tsx` は実装A担当ファイルのため searchParams を追加で渡せない。
        `PaymentList` の入金明細と同じ「クライアント側で必要になったら取得する」設計に合わせた)。
        アクティブな請求が0件でも取消済みだけ存在する場合があるため、常にレンダリングする。
      */}
      <SiteInvoiceList siteId={siteId} rows={rows} />
    </div>
  );
}
