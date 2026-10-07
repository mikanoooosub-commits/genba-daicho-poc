"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { JobRow } from "@/components/sites/job-row";
import type { Job } from "@/lib/types";

// 案件の画面の「施工」の段。記録は専用の画面(/cases/[id]/jobs/new。見本 quick-entry.html の B)で行い、
// 一覧の行の直し・取り消しは v1 の JobRow(編集フォーム)をそのまま使う。
export function CaseJobsSection({
  caseId,
  jobs,
  disabled,
  primary = false,
}: {
  caseId: string;
  jobs: Job[];
  disabled: boolean;
  /** 「施工を記録」がその状態の次の一手のとき true(受注・施工中) */
  primary?: boolean;
}) {
  return (
    <section className="card card-sec card-log section-gap" aria-labelledby="jobs-h">
      <div className="sec-head">
        <h2 id="jobs-h">
          施工<small>{jobs.length}件</small>
        </h2>
      </div>
      {!disabled && (
        <div className="sec-action">
          <Link className={primary ? "btn btn-primary btn-float" : "btn btn-secondary"} href={`/cases/${caseId}/jobs/new`}>
            <Plus className="icon" aria-hidden="true" />
            施工を記録
          </Link>
        </div>
      )}
      <div className="sec-body">
        {jobs.length === 0 ? (
          <p className="empty-inline">まだ施工の記録がありません。「施工を記録」から追加します。</p>
        ) : (
          <div className="flex flex-col gap-3">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
