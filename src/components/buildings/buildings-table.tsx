"use client";

import Link from "next/link";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";

import type { BuildingOverview } from "@/lib/types";
import { formatDate } from "@/lib/format";

// 物件の一覧の表(WO-011 段階1・D82: TanStack Table を使う)。
// 表の部品は「見出しと行の組み立て」だけを TanStack Table に任せ、見た目は v2.css の
// .table / .table-cards(スマホ幅でカードに切り替わる。docs/DESIGN.md §4.1)で出す。
// 並べ替えと絞り込みはサーバー側(URL のクエリ)で行うので、並べ替えの機能は登録していない。

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, BuildingOverview>();

type Props = {
  rows: BuildingOverview[];
  /** 見出しの並べ替えリンク(今の絞り込みを保った URL)。サーバー側で作って渡す */
  sortHrefs: { name: string; last_job: string };
  sort: "name" | "last_job";
};

export function BuildingsTable({ rows, sortHrefs, sort }: Props) {
  const columns = helper.columns([
    helper.accessor("name", {
      header: () =>
        sort === "name" ? (
          <span aria-sort="ascending">物件(名前順)</span>
        ) : (
          <Link className="th-sort-link" href={sortHrefs.name}>
            物件
          </Link>
        ),
      cell: (ctx) => {
        const row = ctx.row.original;
        return (
          <>
            <Link href={`/buildings/${row.building_id}`}>{row.name}</Link>
            <span className="meta">{row.address ?? "住所は未登録"}</span>
          </>
        );
      },
    }),
    helper.accessor("kind", { header: "種類", cell: (ctx) => <span className="kind">{ctx.getValue()}</span> }),
    helper.accessor("default_client_name", {
      header: "ふだんの発注元",
      cell: (ctx) => ctx.getValue() ?? <span className="muted">未設定</span>,
    }),
    helper.accessor("unit_count", { header: "部屋", cell: (ctx) => <span className="num">{ctx.getValue()}</span> }),
    helper.accessor("job_count", { header: "施工", cell: (ctx) => <span className="num">{ctx.getValue()}件</span> }),
    helper.accessor("last_job_date", {
      header: () =>
        sort === "last_job" ? (
          <span aria-sort="descending">最後の施工(新しい順)</span>
        ) : (
          <Link className="th-sort-link" href={sortHrefs.last_job}>
            最後の施工
          </Link>
        ),
      cell: (ctx) => {
        const v = ctx.getValue();
        return v ? <span className="num">{formatDate(v)}</span> : <span className="muted">なし</span>;
      },
    }),
  ]);

  const table = useTable({ features, columns, data: rows });

  // スマホのカードで項目名を出すための data-label
  const labels: Record<string, string> = {
    kind: "種類",
    default_client_name: "ふだんの発注元",
    unit_count: "部屋",
    job_count: "施工",
    last_job_date: "最後の施工",
  };

  return (
    <div className="table-wrap">
      <table className="table table-cards">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id} scope="col" className={header.column.id === "unit_count" || header.column.id === "job_count" ? "r" : undefined}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getAllCells().map((cell) => {
                const id = cell.column.id;
                const cls =
                  id === "name"
                    ? "title-cell"
                    : id === "kind"
                      ? "status-cell"
                      : id === "unit_count" || id === "job_count"
                        ? "r"
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
