"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, RotateCcw, FileText, ImageIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { JobForm } from "@/components/sites/job-form";
import { JobLogDialog } from "@/components/sites/job-log-dialog";
import { setJobDeletedAction } from "@/lib/data/actions-sites";
import { JOB_RATING_META, type Job } from "@/lib/types";
import { formatDate } from "@/lib/format";

export function JobRow({ job }: { job: Job }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggleDeleted(isDeleted: boolean) {
    startTransition(async () => {
      await setJobDeletedAction({ jobId: job.id, isDeleted });
      router.refresh();
    });
  }

  if (editing) {
    return (
      <Card>
        <CardContent>
          <JobForm
            siteId={job.site_id}
            jobId={job.id}
            initial={{
              job_date: job.job_date,
              work_type: job.work_type,
              content: job.content,
              assignee_name: job.assignee_name,
              photo_urls: job.photo_urls,
              rating: job.rating,
              memo: job.memo,
            }}
            submitLabel="保存する"
            onSuccess={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={job.is_deleted ? "opacity-60" : ""}>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold">{formatDate(job.job_date)}</p>
            {job.work_type && <p className="text-xs text-muted-foreground">{job.work_type}</p>}
          </div>
          <Badge className={JOB_RATING_META[job.rating].badgeClass}>
            {JOB_RATING_META[job.rating].label}
          </Badge>
        </div>

        {job.content && <p className="text-sm">{job.content}</p>}
        {job.assignee_name && (
          <p className="text-xs text-muted-foreground">担当: {job.assignee_name}</p>
        )}

        {job.photo_urls.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {job.photo_urls.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ImageIcon className="size-3.5" />
                写真{i + 1}
              </a>
            ))}
          </div>
        )}

        {job.memo && (
          <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 p-2.5 text-sm text-muted-foreground">
            <FileText className="mt-0.5 size-3.5 shrink-0" />
            <span className="whitespace-pre-wrap">{job.memo}</span>
          </p>
        )}

        {job.is_deleted && (
          <Badge variant="outline" className="w-fit text-destructive">
            削除済み
          </Badge>
        )}

        <div className="flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
          {!job.is_deleted && (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
              <Pencil className="size-4" />
              編集
            </Button>
          )}
          <JobLogDialog jobId={job.id} />
          <div className="ml-auto">
            {job.is_deleted ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-primary"
                disabled={pending}
                onClick={() => toggleDeleted(false)}
              >
                <RotateCcw className="size-4" />
                復元
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive"
                disabled={pending}
                onClick={() => toggleDeleted(true)}
              >
                <Trash2 className="size-4" />
                削除
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
