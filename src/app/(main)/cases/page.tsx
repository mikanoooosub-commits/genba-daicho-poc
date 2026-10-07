import Link from "next/link";
import { ChevronDown, ChevronRight, FileWarning, Plus, Search } from "lucide-react";

import { CasesTable } from "@/components/cases/cases-table";
import { RestoreCaseButton } from "@/components/cases/case-controls";
import {
  caseSearchProblem,
  getCaseCounts,
  getCaseOverviews,
  getDeletedCases,
  parseCaseFilter,
} from "@/lib/data/queries-cases";
import { getClients } from "@/lib/data/queries-sites";
import { CASE_DISPLAY_STATUS_ORDER } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  q?: string | string[];
  status?: string | string[];
  client?: string | string[];
  attention?: string | string[];
}>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** 今の絞り込みのうち指定した項目だけを替えた URL(ほかの条件は保つ) */
function hrefWith(
  filter: { q?: string; status?: string; client?: string; attention?: string },
  change: { status?: string | null; attention?: string | null }
): string {
  const next = { ...filter };
  if (change.status !== undefined) next.status = change.status ?? undefined;
  if (change.attention !== undefined) next.attention = change.attention ?? undefined;
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status) params.set("status", next.status);
  if (next.client) params.set("client", next.client);
  if (next.attention) params.set("attention", next.attention);
  const qs = params.toString();
  return qs ? `/cases?${qs}` : "/cases";
}

// 案件の一覧+フィルター(WO-011 段階2・docs/SPEC-v2.md §5.2)。アプリの入口。
// 絞り込みは URL のクエリに持つ(戻る・共有・リロードで状態が消えない)。
// 「要対応」は、いまは「請求が未作成」だけ(期日超過は請求の期日が入る段階4 から)。
export default async function CasesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filter = parseCaseFilter({
    q: first(sp.q),
    status: first(sp.status),
    client: first(sp.client),
    attention: first(sp.attention),
  });
  const problem = caseSearchProblem(filter.q);

  const [rows, counts, clients, deletedCases] = await Promise.all([
    problem ? Promise.resolve([]) : getCaseOverviews(filter),
    getCaseCounts(),
    getClients(),
    getDeletedCases(),
  ]);

  const filtered = Boolean(filter.q || filter.status || filter.client || filter.attention);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>案件</h1>
          <p className="sub">依頼から入金まで、1件の仕事を1行で見ます。</p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-primary" href="/cases/new">
            <Plus className="icon" aria-hidden="true" />
            案件を登録
          </Link>
        </div>
      </div>

      <div className="attention attention-row" aria-label="要対応">
        <Link
          href={filter.attention ? hrefWith(filter, { attention: null }) : hrefWith(filter, { attention: "needs_invoice" })}
          className="warn"
          aria-current={filter.attention ? "true" : undefined}
        >
          <span className="big num">{counts.needsInvoice}</span>
          <span className="txt">
            <span className="ttl">
              <FileWarning className="icon" aria-hidden="true" />
              請求が未作成
            </span>
            <span className="lbl">完了したのに請求がありません{filter.attention ? "(押すと解除)" : ""}</span>
          </span>
          <ChevronRight className="icon go" aria-hidden="true" />
        </Link>
      </div>

      <section className="card has-cards" aria-label="案件の一覧">
        <form className="filters" method="get" action="/cases">
          <div className="field search">
            <label htmlFor="q">探す</label>
            <input
              id="q"
              name="q"
              type="search"
              className="input"
              defaultValue={filter.q ?? ""}
              placeholder="物件名・部屋番号・案件番号・依頼の内容"
            />
          </div>
          <div className="field">
            <label htmlFor="f-client">発注元</label>
            <select id="f-client" name="client" className="select" defaultValue={filter.client ?? ""}>
              <option value="">すべて</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {filter.status && <input type="hidden" name="status" value={filter.status} />}
          {filter.attention && <input type="hidden" name="attention" value={filter.attention} />}
          <button type="submit" className="btn btn-primary">
            <Search className="icon" aria-hidden="true" />
            絞り込む
          </button>
          {filtered && (
            <Link className="btn btn-ghost" href="/cases">
              条件をクリア
            </Link>
          )}
        </form>

        <div className="chips" role="group" aria-label="状態で絞り込む">
          <Link className="chip" href={hrefWith(filter, { status: null })} aria-pressed={!filter.status}>
            すべて {counts.total}
          </Link>
          {CASE_DISPLAY_STATUS_ORDER.map((s) => (
            <Link key={s} className="chip" href={hrefWith(filter, { status: s })} aria-pressed={filter.status === s}>
              {s} {counts.byStatus[s]}
            </Link>
          ))}
        </div>

        {problem && (
          <div className="chips">
            <p className="error-text" role="alert">
              {problem}
            </p>
          </div>
        )}

        <div className="chips">
          <span className="result-count" style={{ marginLeft: 0 }}>
            {filtered ? `${rows.length} 件 / 全 ${counts.total} 件` : `全 ${counts.total} 件`}
          </span>
        </div>

        {rows.length > 0 ? (
          <CasesTable rows={rows} />
        ) : (
          <div className="empty">
            {filtered ? (
              <>
                <h3>条件に合う案件がありません</h3>
                <p>語句を短くするか、条件を外してみてください。</p>
                <Link className="btn btn-secondary" href="/cases">
                  条件をクリア
                </Link>
              </>
            ) : (
              <>
                <h3>案件がまだありません</h3>
                <p>依頼を受けたら、案件として登録します。物件と発注元を選ぶだけで済みます。</p>
                <Link className="btn btn-primary" href="/cases/new">
                  <Plus className="icon" aria-hidden="true" />
                  案件を登録
                </Link>
              </>
            )}
          </div>
        )}
      </section>

      {deletedCases.length > 0 && (
        <details className="card disclosure" style={{ marginTop: "var(--sp-5)" }}>
          <summary>
            <ChevronDown className="icon" aria-hidden="true" />
            取り消した案件({deletedCases.length}件)
          </summary>
          <p className="hint" style={{ margin: "0 var(--sp-5) var(--sp-3)" }}>
            誤って取り消したときは、ここから元に戻せます。施工の記録は残っています。
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: "0 var(--sp-5) var(--sp-5)", display: "grid", gap: "var(--sp-2)" }}>
            {deletedCases.map((c) => (
              <li key={c.id} style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
                <span>
                  {c.case_no}・{c.building_name}
                  {c.room_no ? ` ${c.room_no}` : ""}
                </span>
                <RestoreCaseButton caseId={c.id} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
