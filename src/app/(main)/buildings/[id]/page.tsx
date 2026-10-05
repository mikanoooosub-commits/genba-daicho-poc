import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import { AddUnitsForm } from "@/components/buildings/add-units-form";
import { DeleteBuildingButton, UnitDeletedButton } from "@/components/buildings/delete-controls";
import { StatusLabel, caseStatusTone, paymentTone } from "@/components/status-label";
import {
  getBuildingById,
  getDeletedUnits,
  getUnitHistories,
  getUnitsByBuilding,
  type UnitHistory,
} from "@/lib/data/queries-buildings";
import { getClients } from "@/lib/data/queries-sites";
import { formatDate, formatYen } from "@/lib/format";
import { JOB_RATING_META } from "@/lib/types";

export const dynamic = "force-dynamic";

// 物件の詳細(WO-011 段階1・docs/SPEC-v2.md §5.4)。部屋ごとの履歴を新しい順に並べる。
// 部屋ごとに案件を並べ、それぞれに施工と請求をぶら下げる(段階2)。見積は段階3 で足す。

function UnitSection({ history, buildingId }: { history: UnitHistory; buildingId: string }) {
  const { unit, cases } = history;
  const title = unit?.room_no ?? "物件全体・共用部";
  const anchor = unit ? `u-${unit.id}` : "u-whole";
  const jobCount = cases.reduce((n, c) => n + c.jobs.length, 0);
  const invoiceCount = cases.reduce((n, c) => n + c.invoices.length, 0);
  const newCaseHref = unit ? `/cases/new?building=${buildingId}&unit=${unit.id}` : `/cases/new?building=${buildingId}`;

  return (
    <section className="card unit" id={anchor} aria-labelledby={`h-${anchor}`}>
      <div className="unit-head">
        <h2 id={`h-${anchor}`}>
          {title}
          <small>
            案件 {cases.length}件・施工 {jobCount}件・請求 {invoiceCount}件
          </small>
        </h2>
        <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap", alignItems: "center" }}>
          <Link className="btn btn-secondary btn-sm" href={newCaseHref}>
            {unit ? "この部屋で案件を登録" : "案件を登録"}
          </Link>
          {unit && unit.room_no !== null && <UnitDeletedButton unitId={unit.id} restore={false} />}
        </div>
      </div>
      {cases.length === 0 ? (
        <div className="empty" style={{ padding: "var(--sp-5)" }}>
          <p>{unit ? "この部屋の案件は、まだありません。" : "物件全体・共用部の案件は、まだありません。"}</p>
        </div>
      ) : (
        <ul className="history">
          {cases.map(({ kase, jobs, invoices }) => {
            // 施工と請求を1本の新しい順に並べる
            const items = [
              ...jobs.map((j) => ({ kind: "job" as const, date: j.job_date, id: j.id, job: j })),
              ...invoices.map((i) => ({ kind: "inv" as const, date: i.issue_date ?? "", id: i.invoice_id, inv: i })),
            ].sort((a, b) => b.date.localeCompare(a.date));
            return (
              <li key={kase.case_id} className="case-block">
                <div className="case-line">
                  <Link className="ttl" href={`/cases/${kase.case_id}`}>
                    {kase.case_no}
                  </Link>
                  <StatusLabel tone={caseStatusTone(kase.display_status)}>{kase.display_status}</StatusLabel>
                  <span className="date">受付 {formatDate(kase.received_on)}</span>
                  {kase.is_migrated && <span className="legacy">v1 から移した案件</span>}
                  {kase.needs_invoice && <span className="flag flag-warn">請求が未作成</span>}
                  {!kase.is_migrated && kase.request_summary && <span className="caption">{kase.request_summary}</span>}
                </div>
                {items.length === 0 ? (
                  <p className="caption">施工も請求も、まだありません。</p>
                ) : (
                  <ul className="items">
                    {items.map((it) =>
                      it.kind === "job" ? (
                        <li key={`j-${it.id}`}>
                          <span className="kind-tag job">施工</span>
                          <span className="d num">{formatDate(it.job.job_date)}</span>
                          <span className="what">
                            {[it.job.work_type, it.job.content].filter(Boolean).join(" / ") || "(内容未記入)"}
                          </span>
                          <span className="caption">手応え {JOB_RATING_META[it.job.rating].label}</span>
                        </li>
                      ) : (
                        <li key={`i-${it.id}`}>
                          <span className="kind-tag inv">請求</span>
                          <span className="d num">{it.inv.issue_date ? formatDate(it.inv.issue_date) : "日付なし"}</span>
                          <span className="what">
                            <span className="num">{formatYen(it.inv.amount)}</span>(税込・内訳なし)
                            {it.inv.paid_amount > 0 && it.inv.payment_status !== "入金済" && (
                              <> ・入金済み <span className="num">{formatYen(it.inv.paid_amount)}</span></>
                            )}
                          </span>
                          <StatusLabel tone={paymentTone(it.inv.payment_status)}>{it.inv.payment_status}</StatusLabel>
                        </li>
                      )
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default async function BuildingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const building = await getBuildingById(id);
  if (!building) notFound();

  const [units, clients, deletedUnits] = await Promise.all([
    getUnitsByBuilding(building.id),
    getClients(),
    getDeletedUnits(building.id),
  ]);
  const histories = await getUnitHistories(building.id, units);
  const clientName = clients.find((c) => c.id === building.default_client_id)?.name ?? null;

  const allCases = histories.flatMap((h) => h.cases);
  const allJobs = allCases.flatMap((c) => c.jobs);
  const allInvoices = allCases.flatMap((c) => c.invoices);
  const unpaid = allInvoices.reduce((sum, i) => sum + Math.max(i.amount - i.paid_amount, 0), 0);
  const lastJob = allJobs.map((j) => j.job_date).sort().reverse()[0] ?? null;
  const roomNumbers = units.map((u) => u.room_no).filter((r): r is string => r !== null);

  return (
    <>
      <p className="breadcrumb">
        <Link href="/buildings">物件</Link> › {building.name}
      </p>

      <section className="card card-pad" aria-labelledby="bname" style={{ marginBottom: "var(--sp-5)" }}>
        <div className="b-title">
          <h1 id="bname">{building.name}</h1>
          <span className="kind">{building.kind}</span>
          <Link className="btn btn-secondary btn-sm" href={`/buildings/${building.id}/edit`} style={{ marginLeft: "auto" }}>
            <Pencil className="icon" aria-hidden="true" />
            編集
          </Link>
        </div>
        <dl className="dl">
          <dt>住所</dt>
          <dd>
            {building.address ?? <span className="muted">未登録</span>}
            {!building.address && (
              <>
                {" "}
                <Link href={`/buildings/${building.id}/edit`} className="caption">
                  住所を入れる
                </Link>
              </>
            )}
          </dd>
          <dt>ふだんの発注元</dt>
          <dd>{clientName ?? <span className="muted">未設定</span>}</dd>
          <dt>メモ</dt>
          <dd>{building.memo ?? <span className="muted">なし</span>}</dd>
          <dt>部屋</dt>
          <dd>{roomNumbers.length > 0 ? `${roomNumbers.join("・")}(${roomNumbers.length}部屋を登録)` : <span className="muted">部屋の登録なし</span>}</dd>
        </dl>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--sp-4)" }}>
          <DeleteBuildingButton buildingId={building.id} unitCount={roomNumbers.length} jobCount={allJobs.length} />
        </div>
      </section>

      <div className="stats">
        <div className="stat">
          <div className="k">部屋</div>
          <div className="v num">{roomNumbers.length}</div>
        </div>
        <div className="stat">
          <div className="k">施工</div>
          <div className="v num">{allJobs.length}件</div>
        </div>
        <div className="stat">
          <div className="k">案件</div>
          <div className="v num">{allCases.length}件</div>
        </div>
        <div className="stat">
          <div className="k">未入金(税込)</div>
          <div className="v num" style={unpaid > 0 ? { color: "var(--st-danger-fg)" } : undefined}>
            {formatYen(unpaid)}
          </div>
        </div>
        <div className="stat">
          <div className="k">最後の施工</div>
          <div className="v num" style={{ fontSize: 18, paddingTop: 4 }}>
            {lastJob ? formatDate(lastJob) : "なし"}
          </div>
        </div>
      </div>

      <div className="unit-jump">
        <span className="caption">部屋へ移動</span>
        {histories.map((h) => (
          <a key={h.unit?.id ?? "whole"} className="chip" href={h.unit ? `#u-${h.unit.id}` : "#u-whole"}>
            {h.unit?.room_no ?? "物件全体・共用部"}
          </a>
        ))}
        <AddUnitsForm buildingId={building.id} />
      </div>

      {histories.map((h) => (
        <UnitSection key={h.unit?.id ?? "whole"} history={h} buildingId={building.id} />
      ))}

      {deletedUnits.length > 0 && (
        <section className="card card-pad" aria-labelledby="deleted-units">
          <h2 id="deleted-units" style={{ fontSize: "var(--fs-lead)", marginBottom: "var(--sp-3)" }}>
            取り消した部屋
          </h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--sp-2)" }}>
            {deletedUnits.map((u) => (
              <li key={u.id} style={{ display: "flex", gap: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
                <span>{u.room_no ?? "物件全体・共用部"}</span>
                <UnitDeletedButton unitId={u.id} restore />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
