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
import { getVisitLogsAction } from "@/lib/data/actions";
import { RATING_META, type Visit, type VisitAction, type VisitLogWithUser } from "@/lib/types";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";

const ACTION_META: Record<VisitAction, { label: string; icon: typeof Plus; className: string }> = {
  create: { label: "登録", icon: Plus, className: "text-rating-good" },
  update: { label: "編集", icon: Pencil, className: "text-primary" },
  delete: { label: "削除", icon: Trash2, className: "text-destructive" },
};

const FIELD_LABELS: { key: keyof Visit; label: string; fmt?: (v: unknown) => string }[] = [
  { key: "date", label: "配布日", fmt: (v) => formatDate(v as string) },
  { key: "start_time", label: "開始", fmt: (v) => formatTime(v as string) || "—" },
  { key: "end_time", label: "終了", fmt: (v) => formatTime(v as string) || "—" },
  { key: "count", label: "枚数", fmt: (v) => (v == null ? "—" : String(v)) },
  { key: "rating", label: "評価", fmt: (v) => (v ? RATING_META[v as keyof typeof RATING_META].label : "—") },
  { key: "memo", label: "メモ", fmt: (v) => (v ? String(v) : "—") },
];

function diffFields(before: Visit | null, after: Visit | null) {
  if (!before || !after) return [];
  const changes: { label: string; from: string; to: string }[] = [];
  for (const f of FIELD_LABELS) {
    const b = before[f.key];
    const a = after[f.key];
    if (b !== a) {
      const fmt = f.fmt ?? ((v: unknown) => String(v ?? "—"));
      changes.push({ label: f.label, from: fmt(b), to: fmt(a) });
    }
  }
  return changes;
}

export function VisitLogDialog({ visitId }: { visitId: string }) {
  const [logs, setLogs] = useState<VisitLogWithUser[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleOpenChange(open: boolean) {
    if (open && logs === null && !loading) {
      setLoading(true);
      try {
        setLogs(await getVisitLogsAction(visitId));
      } catch {
        setLogs([]);
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

        {!loading && logs && logs.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">履歴はまだありません</p>
        )}

        {!loading && logs && logs.length > 0 && (
          <ol className="flex flex-col gap-3">
            {logs.map((log) => {
              const meta = ACTION_META[log.action];
              const Icon = meta.icon;
              const changes = diffFields(log.before_data, log.after_data);
              return (
                <li
                  key={log.id}
                  className="rounded-xl border border-border/60 bg-card p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 font-bold ${meta.className}`}>
                      <Icon className="size-4" />
                      {meta.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(log.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {log.userName ? log.userName : "不明なユーザー"}
                  </p>
                  {log.action === "update" && changes.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {changes.map((c, i) => (
                        <li key={i} className="text-xs">
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
