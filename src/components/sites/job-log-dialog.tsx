"use client";

import { useState } from "react";
import { History, Plus, Pencil, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
// 監査ログの取得は実装B(actions-ledger.ts)が entity_type 横断(jobs/invoices/payments)で
// 用意している既存の Server Action を再利用する(SPEC.md §7・実装Bファイルは変更しない)。
import { getAuditLogsAction } from "@/lib/data/actions-ledger";
import { JOB_RATING_META, type AuditLogAction, type AuditLogWithUser, type JobRating } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/format";

const ACTION_META: Record<AuditLogAction, { label: string; icon: typeof Plus; className: string }> = {
  create: { label: "登録", icon: Plus, className: "text-rating-good" },
  update: { label: "編集", icon: Pencil, className: "text-primary" },
  delete: { label: "削除", icon: Trash2, className: "text-destructive" },
};

function isJobRating(v: unknown): v is JobRating {
  return v === "good" || v === "normal" || v === "bad";
}

const FIELD_LABELS: { key: string; label: string; fmt: (v: unknown) => string }[] = [
  { key: "job_date", label: "施工日", fmt: (v) => (typeof v === "string" ? formatDate(v) : "—") },
  { key: "work_type", label: "工種", fmt: (v) => (v ? String(v) : "—") },
  { key: "content", label: "施工内容", fmt: (v) => (v ? String(v) : "—") },
  { key: "assignee_name", label: "担当", fmt: (v) => (v ? String(v) : "—") },
  { key: "rating", label: "仕上がり", fmt: (v) => (isJobRating(v) ? JOB_RATING_META[v].label : "—") },
  { key: "memo", label: "メモ", fmt: (v) => (v ? String(v) : "—") },
];

function diffFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return [];
  const changes: { label: string; from: string; to: string }[] = [];
  for (const f of FIELD_LABELS) {
    const b = before[f.key];
    const a = after[f.key];
    if (b !== a) changes.push({ label: f.label, from: f.fmt(b), to: f.fmt(a) });
  }
  return changes;
}

/** 施工の変更履歴（既存 VisitLogDialog と同じ構成）。「AIは間違えます。だから直す前提で作りました」の実装 */
export function JobLogDialog({ jobId }: { jobId: string }) {
  const [logs, setLogs] = useState<AuditLogWithUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  async function handleOpenChange(open: boolean) {
    if (open && logs === null && !loading) {
      setLoading(true);
      setLoadError("");
      try {
        // getAuditLogsAction はISSUE-003対応でResult型({ok:true,logs}|{ok:false,error})を
        // 返すようになった(実装B・actions-ledger.ts)。throwはしなくなったが、ネットワーク断
        // 等の予期しない例外に備えてtry/catchは残す
        const result = await getAuditLogsAction({ entityType: "jobs", entityId: jobId });
        if (result.ok) {
          setLogs(result.logs);
        } else {
          setLogs([]);
          setLoadError(result.error);
        }
      } catch (e) {
        setLogs([]);
        setLoadError(e instanceof Error ? e.message : "変更履歴の取得に失敗しました");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <History className="size-4" />
          変更履歴
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>変更履歴</DialogTitle>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-muted-foreground">読み込み中…</p>}
        {!loading && loadError && <p className="py-6 text-center text-sm text-destructive">{loadError}</p>}
        {!loading && !loadError && logs && logs.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">履歴はまだありません</p>
        )}

        {!loading && logs && logs.length > 0 && (
          <ol className="flex flex-col gap-3">
            {logs.map((log) => {
              const meta = ACTION_META[log.action];
              const Icon = meta.icon;
              const changes = diffFields(log.before_data, log.after_data);
              return (
                <li key={log.id} className="rounded-xl border border-border/60 bg-card p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 font-bold ${meta.className}`}>
                      <Icon className="size-4" />
                      {meta.label}
                    </span>
                    <span className="text-sm text-muted-foreground">{formatDateTime(log.created_at)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {log.userName ? log.userName : "不明なユーザー"}
                  </p>
                  {log.action === "update" && changes.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {changes.map((c, i) => (
                        <li key={i} className="text-sm">
                          <span className="font-bold">{c.label}</span>：{c.from}
                          <span className="mx-1 text-muted-foreground">→</span>
                          <span className="text-foreground">{c.to}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
