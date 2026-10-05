"use client";

import Link from "next/link";
import { FileWarning } from "lucide-react";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";

import { StatusLabel, caseStatusTone } from "@/components/status-label";
import type { CaseOverview } from "@/lib/types";
import { formatDate, formatYen } from "@/lib/format";

// 案件の一覧の表(WO-011 段階2・docs/SPEC-v2.md §5.2)。物件の一覧(buildings-table.tsx)と同じ作り:
// 表の組み立てだけを TanStack Table に任せ、見た目は v2.css の .table / .table-cards(スマホ幅でカード)。
// 並べ替え・絞り込みはサーバー側(URL のクエリ)で行う。
// 状態のラベルは1つだけ(display_status)。「請求が未作成」は、ラベルではなく別の列に文字とアイコンで出す。
// 期日超過は請求の期日が入る段階4 から。

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, CaseOverview>();

function roomLabel(row: CaseOverview): string {
  return row.room_no ? `${row.building_name} ${row.room_no}` : row.building_name;
}

export function CasesTable({ rows }: { rows: CaseOverview[] }) {
  const columns = helper.columns([
    helper.accessor("case_no", {
      header: "案件",
      cell: (ctx) => {
        const row = ctx.row.original;
        return (
          <>
            <Link href={`/cases/${row.case_id}`}>{roomLabel(row)}</Link>
            <span className="meta">
              {row.case_no}
              {row.is_migrated ? "・v1 からの移行分" : ""}
              {row.request_summary && !row.is_migrated ? `・${row.request_summary}` : ""}
            </span>
          </>
        );
      },
    }),
    helper.accessor("client_name", { header: "発注元" }),
    helper.accessor("received_on", {
      header: "受付日",
      cell: (ctx) => <span className="num">{formatDate(ctx.getValue())}</span>,
    }),
    helper.accessor("display_status", {
      header: "状態",
      cell: (ctx) => <StatusLabel tone={caseStatusTone(ctx.getValue())}>{ctx.getValue()}</StatusLabel>,
    }),
    helper.accessor("invoiced_total", {
      header: "請求(税込)",
      cell: (ctx) => {
        const row = ctx.row.original;
        return row.invoice_count > 0 ? <span className="num">{formatYen(ctx.getValue())}</span> : <span className="muted">—</span>;
      },
    }),
    helper.accessor("needs_invoice", {
      header: "気づき",
      cell: (ctx) =>
        ctx.getValue() ? (
          <span className="flag flag-warn">
            <FileWarning className="icon" aria-hidden="true" />
            請求が未作成
          </span>
        ) : null,
    }),
  ]);

  const table = useTable({ features, columns, data: rows });

  // スマホのカードで項目名を出すための data-label
  const labels: Record<string, string> = {
    client_name: "発注元",
    received_on: "受付日",
    invoiced_total: "請求(税込)",
  };

  return (
    <div className="table-wrap">
      <table className="table table-cards">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} scope="col" className={header.column.id === "invoiced_total" ? "r" : undefined}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={row.original.needs_invoice ? "is-warn" : undefined}>
              {row.getAllCells().map((cell) => {
                const id = cell.column.id;
                const cls =
                  id === "case_no"
                    ? "title-cell"
                    : id === "display_status"
                      ? "status-cell"
                      : id === "invoiced_total"
                        ? "r"
                        : id === "needs_invoice"
                          ? "flag-cell"
                          : undefined;
                return (
                  <td key={cell.id} className={cls} data-label={labels[id]}>
                    <table.FlexRender cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
