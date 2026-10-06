import Link from "next/link";

import { CreateEstimateButton } from "@/components/estimates/create-estimate-button";
import { StatusLabel, type StatusTone } from "@/components/status-label";
import { formatDate, formatYen } from "@/lib/format";
import type { Estimate, EstimateStatus } from "@/lib/types";

const TONE: Record<EstimateStatus, StatusTone> = {
  下書き: "neutral",
  提出済: "info",
  採用: "good",
  不採用: "lost",
};

// 案件の画面の「見積」(WO-011 段階3)。版ごとの状態と税込の合計を並べる。作るのは人が押したとき。
export function CaseEstimatesSection({
  caseId,
  estimates,
  disabled,
}: {
  caseId: string;
  estimates: Estimate[];
  disabled: boolean;
}) {
  return (
    <section className="card card-pad section-gap" aria-labelledby="estimates-h">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sp-3)", flexWrap: "wrap" }}>
        <h2 id="estimates-h" style={{ fontSize: "var(--fs-lead)" }}>見積</h2>
        {!disabled && <CreateEstimateButton caseId={caseId} label={estimates.length === 0 ? "見積を作る" : "別の見積を作る"} />}
      </div>
      {estimates.length === 0 ? (
        <p className="muted" style={{ marginTop: "var(--sp-3)" }}>
          見積はまだありません。{disabled ? "" : "「見積を作る」で、明細と合計を入れられます。同じ部屋や物件の前回の見積を写せます。"}
        </p>
      ) : (
        <ul className="est-list" style={{ marginTop: "var(--sp-2)" }}>
          {estimates.map((e) => (
            <li key={e.id}>
              <span className="grow">
                <Link href={`/estimates/${e.id}`}>
                  <strong className="num">{e.estimate_no}</strong> 第{e.version}版
                </Link>
                {e.issue_date && <span className="muted"> ・提出 {formatDate(e.issue_date)}</span>}
              </span>
              <StatusLabel tone={TONE[e.status]}>{e.status}</StatusLabel>
              <span className="num" style={{ minWidth: 150, textAlign: "right" }}>
                税込 <strong>{formatYen(e.total_yen)}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
