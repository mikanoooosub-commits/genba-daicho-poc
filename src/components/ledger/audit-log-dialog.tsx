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
import { getAuditLogsAction } from "@/lib/data/actions-ledger";
import type { AuditLogAction, AuditLogEntityType, AuditLogWithUser } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

const ACTION_META: Record<AuditLogAction, { label: string; icon: typeof Plus; className: string }> = {
  create: { label: "登録", icon: Plus, className: "text-rating-good" },
  update: { label: "編集", icon: Pencil, className: "text-primary" },
  delete: { label: "取消", icon: Trash2, className: "text-destructive" },
};

export type AuditFieldLabel = {
  key: string;
  label: string;
  fmt?: (v: unknown) => string;
};

function defaultFmt(v: unknown): string {
  if (v == null) return "—";
  return String(v);
}

function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  fields: AuditFieldLabel[]
) {
  if (!before || !after) return [];
  const changes: { label: string; from: string; to: string }[] = [];
  for (const f of fields) {
    const b = before[f.key];
    const a = after[f.key];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      const fmt = f.fmt ?? defaultFmt;
      changes.push({ label: f.label, from: fmt(b), to: fmt(a) });
    }
  }
  return changes;
}

/**
 * jobs/invoices/payments 共通の変更履歴ダイアログ。既存 VisitLogDialog と同じ見た目・挙動を
 * 一般化したもの(SPEC.md §7: getAuditLogsAction は既存 getVisitLogsAction と同じパターン)。
 * 削除(action='delete')の理由は before_data.memo に埋め込まれる運用
 * (actions-ledger.ts の setInvoiceDeletedAction/setPaymentDeletedAction 参照)なので、
 * 「削除前の状態」としてそのまま表示すれば理由も読める。
 */
export function AuditLogDialog({
  entityType,
  entityId,
  fields,
  triggerLabel = "変更履歴",
}: {
  entityType: AuditLogEntityType;
  entityId: string;
  fields: AuditFieldLabel[];
  triggerLabel?: string;
}) {
  const [logs, setLogs] = useState<AuditLogWithUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  async function handleOpenChange(open: boolean) {
    if (open && logs === null && !loading) {
      setLoading(true);
      setLoadError("");
      try {
        const result = await getAuditLogsAction({ entityType, entityId });
        if (result.ok) {
          setLogs(result.logs);
        } else {
          setLogs([]);
          setLoadError(result.error);
        }
      } catch (e) {
        // getAuditLogsAction は通常throwしない(Result型を返す)が、ネットワーク断など
        // 予期しない例外に備えて防御的に受ける(ISSUE-003対応)。
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
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>変更履歴</DialogTitle>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-muted-foreground">読み込み中…</p>}

        {!loading && loadError && (
          <p className="py-6 text-center text-sm text-destructive">
            履歴を取得できませんでした({loadError})
          </p>
        )}

        {!loading && !loadError && logs && logs.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">履歴はまだありません</p>
        )}

        {!loading && !loadError && logs && logs.length > 0 && (
          <ol className="flex flex-col gap-3">
            {logs.map((log) => {
              const meta = ACTION_META[log.action];
              const Icon = meta.icon;
              const changes =
                log.action === "update" ? diffFields(log.before_data, log.after_data, fields) : [];
              return (
                <li key={log.id} className="rounded-xl border border-border/60 bg-card p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 font-bold ${meta.className}`}>
                      <Icon className="size-4" />
                      {meta.label}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatDateTime(log.created_at)}
                    </span>
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
                  {log.action === "delete" && log.before_data && (
                    <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-sm text-muted-foreground">
                      {typeof log.before_data.memo === "string" && log.before_data.memo
                        ? log.before_data.memo
                        : "取消理由の記録がありません"}
                    </p>
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
