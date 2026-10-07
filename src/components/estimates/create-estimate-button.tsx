"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";

import { createEstimateAction } from "@/lib/data/actions-estimates";

// 案件から見積(下書き)を作って、見積の画面へ移る。移動は Server Action の redirect が行う。
export function CreateEstimateButton({
  caseId,
  label = "見積を作る",
  primary = false,
}: {
  caseId: string;
  label?: string;
  /** その状態で次にやる1つのとき true(主のボタン。スマホでは下ナビの上に浮く) */
  primary?: boolean;
}) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function create() {
    setError("");
    startTransition(async () => {
      const result = await createEstimateAction({ caseId });
      if (result && !result.ok) setError(result.error); // 成功すると redirect で画面が移る
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "var(--sp-1)" }}>
      <button className={primary ? "btn btn-primary btn-float" : "btn btn-secondary"} type="button" disabled={pending} onClick={create}>
        <Plus className="icon" aria-hidden="true" />
        {pending ? "作っています…" : label}
      </button>
      {error && (
        <span role="alert" style={{ color: "var(--st-danger-fg)", fontSize: "var(--fs-caption)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
