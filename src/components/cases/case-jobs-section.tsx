"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { JobRow } from "@/components/sites/job-row";
import type { Job } from "@/lib/types";

// 案件の画面の「施工」の段。記録は専用の画面(/cases/[id]/jobs/new。見本 quick-entry.html の B)で行い、
// 一覧の行の直し・取り消しは v1 の JobRow(編集フォーム)をそのまま使う。
export function CaseJobsSection({ caseId, jobs, disabled }: { caseId: string; jobs: Job[]; disabled: boolean }) {
  return (
    <section className="section-gap" aria-labelledby="jobs-h">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sp-3)" }}>
        <h2 id="jobs-h" style={{ fontSize: "var(--fs-lead)" }}>
          施工<small className="muted" style={{ marginLeft: "var(--sp-2)", fontWeight: 400 }}>{jobs.length}件</small>
        </h2>
        {!disabled && (
          <Link className="btn btn-primary btn-sm" href={`/cases/${caseId}/jobs/new`}>
            <Plus className="icon" aria-hidden="true" />
            施工を記録
          </Link>
        )}
      </div>
      {jobs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            まだ施工の記録がありません。「施工を記録」から追加します。
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </div>
      )}
    </section>
  );
}
