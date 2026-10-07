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
  primary = false,
  primaryPayment = false,
}: {
  siteId: string;
  buildingName: string;
  /** 「請求を追加」がその状態の次の一手のとき true */
  primary?: boolean;
  /** 「入金を登録」がその状態の次の一手のとき true(請求済) */
  primaryPayment?: boolean;
}) {
  const rows = await getInvoiceLedger({ siteId });

  return (
    <section className="card card-sec card-log section-gap" aria-labelledby="invoices-h">
      <div className="sec-head">
        <h2 id="invoices-h">請求・入金</h2>
      </div>
      <div className="sec-action">
        <SiteInvoiceAddButton siteId={siteId} buildingName={buildingName} primary={primary} />
      </div>
      <div className="sec-body">
        {rows.length === 0 ? <p className="empty-inline">(請求はまだありません)</p> : null}

        {/*
          取消済み請求(ISSUE-007)は SiteInvoiceList 側でオンデマンド取得する
          (`sites/[id]/page.tsx` は実装A担当ファイルのため searchParams を追加で渡せない。
          `PaymentList` の入金明細と同じ「クライアント側で必要になったら取得する」設計に合わせた)。
          アクティブな請求が0件でも取消済みだけ存在する場合があるため、常にレンダリングする。
        */}
        <SiteInvoiceList siteId={siteId} rows={rows} primaryPayment={primaryPayment} />
      </div>
    </section>
  );
}
