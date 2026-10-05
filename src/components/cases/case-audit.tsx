"use client";

import { AuditLogDialog, type AuditFieldLabel } from "@/components/ledger/audit-log-dialog";

// 案件の変更履歴。項目の表示形(fmt は関数)は、サーバーの画面からクライアントの部品へ渡せないので、
// 項目の一覧はこのクライアント側の部品に持たせる。
function caseFields(clientNames: Record<string, string>): AuditFieldLabel[] {
  return [
    { key: "status", label: "状態" },
    { key: "lead_source", label: "集客経路" },
    { key: "client_id", label: "発注元", fmt: (v) => (typeof v === "string" ? (clientNames[v] ?? "(不明な発注元)") : "—") },
    { key: "received_on", label: "受付日" },
    { key: "work_kind", label: "種類" },
    { key: "request_summary", label: "依頼の内容" },
    { key: "lost_reason", label: "失注の理由" },
    { key: "is_deleted", label: "取り消し", fmt: (v) => (v ? "取り消し済み" : "有効") },
  ];
}

export function CaseAuditLog({ caseId, clientNames }: { caseId: string; clientNames: Record<string, string> }) {
  return <AuditLogDialog entityType="cases" entityId={caseId} fields={caseFields(clientNames)} triggerLabel="変更履歴" />;
}
