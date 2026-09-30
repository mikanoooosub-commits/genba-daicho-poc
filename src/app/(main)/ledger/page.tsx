import { AppHeader } from "@/components/app-header";
import { LedgerView } from "@/components/ledger/ledger-view";
import {
  getClientOptions,
  getDeletedInvoices,
  getInvoiceLedger,
  getSiteOptions,
  summarizeInvoiceLedger,
} from "@/lib/data/queries-ledger";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  client?: string;
  lead?: string;
  month?: string;
  deleted?: string;
}>;

export default async function LedgerPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filters = {
    clientId: sp.client ?? "",
    leadSource: sp.lead ?? "",
    month: sp.month ?? "",
  };
  // ISSUE-007対応: 「取消済みを表示」。ジョブ側(sites/[id]の`?deleted=1`)と同じURL方式。
  // 台帳の集計対象には含めないため、summarizeInvoiceLedger には渡さない(rowsのみを渡す)。
  const includeDeleted = sp.deleted === "1";

  const [rows, clientOptions, siteOptions, deletedInvoices] = await Promise.all([
    getInvoiceLedger({
      clientId: filters.clientId || undefined,
      leadSource: filters.leadSource || undefined,
      month: filters.month || undefined,
    }),
    getClientOptions(),
    getSiteOptions(),
    includeDeleted ? getDeletedInvoices() : Promise.resolve([]),
  ]);
  const summary = summarizeInvoiceLedger(rows);

  return (
    <>
      <AppHeader title="台帳" subtitle="発注元別・集客経路別・月次の請求と入金" />
      <main className="px-4 py-4">
        <LedgerView
          rows={rows}
          summary={summary}
          clientOptions={clientOptions}
          siteOptions={siteOptions}
          filters={filters}
          includeDeleted={includeDeleted}
          deletedInvoices={deletedInvoices}
        />
      </main>
    </>
  );
}
