import { CheckCircle2, Circle, CircleDot, Clock, Minus, type LucideIcon } from "lucide-react";

// 状態のラベル(docs/DESIGN.md §2.2・§3.3)。1つの対象に1つだけ。
// 色だけに頼らず、形の違うアイコンと文字で示す。

export type StatusTone = "neutral" | "progress" | "info" | "good" | "lost";

const TONE: Record<StatusTone, { className: string; icon: LucideIcon }> = {
  neutral: { className: "status status-neutral", icon: Circle },
  progress: { className: "status status-progress", icon: CircleDot },
  info: { className: "status status-info", icon: Clock },
  good: { className: "status status-good", icon: CheckCircle2 },
  lost: { className: "status status-lost", icon: Minus },
};

export function StatusLabel({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  const { className, icon: Icon } = TONE[tone];
  return (
    <span className={className}>
      <Icon className="icon" aria-hidden="true" />
      {children}
    </span>
  );
}

/** 請求の入金状況(invoice_ledger.payment_status)に対応するラベルの色 */
export function paymentTone(status: "未入金" | "一部入金" | "入金済"): StatusTone {
  return status === "入金済" ? "good" : "info";
}

/** 案件の状態(case_overview.display_status の8つ)に対応するラベルの色。形の違うアイコンと文字を必ず添える */
export function caseStatusTone(status: "依頼" | "見積中" | "受注" | "施工中" | "完了" | "請求済" | "入金済" | "失注"): StatusTone {
  switch (status) {
    case "依頼":
    case "見積中":
      return "neutral";
    case "受注":
    case "施工中":
    case "完了":
      return "progress";
    case "請求済":
      return "info";
    case "入金済":
      return "good";
    case "失注":
      return "lost";
  }
}
