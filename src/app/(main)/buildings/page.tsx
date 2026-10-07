import Link from "next/link";
import { ChevronDown, Plus, Search } from "lucide-react";

import { RestoreBuildingButton } from "@/components/buildings/delete-controls";
import { BuildingsTable } from "@/components/buildings/buildings-table";
import {
  countBuildings,
  getBuildingOverviews,
  getDeletedBuildings,
  parseBuildingFilter,
  parseBuildingSort,
  searchTermProblem,
} from "@/lib/data/queries-buildings";
import { getClients } from "@/lib/data/queries-sites";
import { BUILDING_KIND_ORDER } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  q?: string | string[];
  kind?: string | string[];
  client?: string | string[];
  sort?: string | string[];
}>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** 今の絞り込みを保ったまま、並び順だけを替えた URL */
function hrefWith(filter: { q?: string; kind?: string; client?: string }, sort: string): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.kind) params.set("kind", filter.kind);
  if (filter.client) params.set("client", filter.client);
  if (sort !== "name") params.set("sort", sort);
  const qs = params.toString();
  return qs ? `/buildings?${qs}` : "/buildings";
}

// 物件の一覧+フィルター(WO-011 段階1・docs/SPEC-v2.md §5.1)。
// 絞り込みは URL のクエリに持つ(戻る・共有・リロードで状態が消えない)。
export default async function BuildingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const filter = parseBuildingFilter({ q: first(sp.q), kind: first(sp.kind), client: first(sp.client) });
  const sort = parseBuildingSort(first(sp.sort));
  const problem = searchTermProblem(filter.q);

  const [rows, total, clients, deletedBuildings] = await Promise.all([
    problem ? Promise.resolve([]) : getBuildingOverviews(filter, sort),
    countBuildings(),
    getClients(),
    getDeletedBuildings(),
  ]);

  const filtered = Boolean(filter.q || filter.kind || filter.client);
  const sortHrefs = { name: hrefWith(filter, "name"), last_job: hrefWith(filter, "last_job") };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>物件</h1>
          <p className="sub">建物ごとに、部屋と過去の仕事を見ます。</p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-primary" href="/buildings/new">
            <Plus className="icon" aria-hidden="true" />
            物件を登録
          </Link>
        </div>
      </div>

      <section className="card has-cards" aria-label="物件の一覧">
        <form className="filters" method="get" action="/buildings">
          <div className="field search">
            <label htmlFor="q">探す</label>
            <input
              id="q"
              name="q"
              type="search"
              className="input"
              defaultValue={filter.q ?? ""}
              placeholder="物件名・住所・部屋番号"
            />
          </div>
          <div className="field">
            <label htmlFor="f-kind">種類</label>
            <select id="f-kind" name="kind" className="select" defaultValue={filter.kind ?? ""}>
              <option value="">すべて</option>
              {BUILDING_KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-client">ふだんの発注元</label>
            <select id="f-client" name="client" className="select" defaultValue={filter.client ?? ""}>
              <option value="">すべて</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {sort !== "name" && <input type="hidden" name="sort" value={sort} />}
          <button type="submit" className="btn btn-secondary">
            <Search className="icon" aria-hidden="true" />
            絞り込む
          </button>
          {filtered && (
            <Link className="btn btn-ghost" href="/buildings">
              条件をクリア
            </Link>
          )}
        </form>

        {problem && (
          <div className="chips">
            <p className="error-text" role="alert">
              {problem}
            </p>
          </div>
        )}

        <div className="chips">
          <span className="result-count" style={{ marginLeft: 0 }}>
            {filtered ? `${rows.length} 件 / 全 ${total} 件` : `全 ${total} 件`}
          </span>
        </div>

        {rows.length > 0 ? (
          <BuildingsTable rows={rows} sortHrefs={sortHrefs} sort={sort} />
        ) : (
          <div className="empty">
            {filtered ? (
              <>
                <h3>条件に合う物件がありません</h3>
                <p>語句を短くするか、条件を外してみてください。</p>
                <Link className="btn btn-secondary" href="/buildings">
                  条件をクリア
                </Link>
              </>
            ) : (
              <>
                <h3>物件がまだありません</h3>
                <p>建物を登録すると、部屋ごとの過去の仕事をここから引けます。</p>
                <Link className="btn btn-primary" href="/buildings/new">
                  <Plus className="icon" aria-hidden="true" />
                  物件を登録
                </Link>
              </>
            )}
          </div>
        )}
      </section>

      {deletedBuildings.length > 0 && (
        <details className="card disclosure" style={{ marginTop: "var(--sp-5)" }}>
          <summary>
            <ChevronDown className="icon" aria-hidden="true" />
            取り消した物件({deletedBuildings.length}件)
          </summary>
          <p className="hint" style={{ margin: "0 var(--sp-5) var(--sp-3)" }}>
            誤って取り消したときは、ここから元に戻せます。部屋や施工の記録は残っています。
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: "0 var(--sp-5) var(--sp-5)", display: "grid", gap: "var(--sp-2)" }}>
            {deletedBuildings.map((b) => (
              <li key={b.id} style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
                <span>
                  {b.name}
                  {b.address ? `(${b.address})` : ""}
                </span>
                <RestoreBuildingButton buildingId={b.id} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
