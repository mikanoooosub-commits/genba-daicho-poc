"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createJobAction } from "@/lib/data/actions-sites";
import { todayISO } from "@/lib/format";
import type { JobRating } from "@/lib/types";

// 施工の記録(現場でスマホ1分)。見本 docs/design-samples/quick-entry.html の B の形。
// 日付・工種・担当・手応えはボタンで選び、文字を打つのは内容の1行だけ。押す場所は 48px 以上、記録は下に固定。
// 写真URL・メモは「詳しく入れる」を開いたときだけ出す。
// 担当は「本人/従業員/外注」の区分だけ(個人名の欄は作らない。D90-2)。
// 工種で「その他」を選んだときは、内容の1行に書いてもらう(欄は増やさない)。
// 保存は v1 の createJobAction(案件の sites 行に付ける。case_id は createJobAction が結びつける)。

const WORK_TYPES = ["クロス", "クリーニング", "床の補修", "水回り", "設備の交換", "その他"] as const;
const ASSIGNEES = ["本人", "従業員", "外注"] as const;
const RATINGS: { value: JobRating; label: string }[] = [
  { value: "good", label: "良い" },
  { value: "normal", label: "ふつう" },
  { value: "bad", label: "気になる点あり" },
];

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

type Props = {
  caseId: string;
  siteId: string;
  placeLabel: string;
  caseNo: string;
  clientName: string;
};

export function CaseJobQuickForm({ caseId, siteId, placeLabel, caseNo, clientName }: Props) {
  const router = useRouter();
  const today = todayISO();
  const yesterday = addDays(today, -1);

  const [dateMode, setDateMode] = useState<"today" | "yesterday" | "pick">("today");
  const [pickedDate, setPickedDate] = useState(today);
  const [workType, setWorkType] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [assignee, setAssignee] = useState<string>("本人");
  const [rating, setRating] = useState<JobRating>("normal");
  const [photoUrlsText, setPhotoUrlsText] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const jobDate = dateMode === "today" ? today : dateMode === "yesterday" ? yesterday : pickedDate;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!workType) {
      setError("工種を選んでください");
      return;
    }
    if (!jobDate) {
      setError("日付を選んでください");
      return;
    }
    const photoUrls = photoUrlsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    startTransition(async () => {
      const result = await createJobAction({
        siteId,
        jobDate,
        workType,
        content: content.trim() || undefined,
        assigneeName: assignee,
        photoUrls,
        rating,
        memo: memo.trim() || undefined,
      });
      if (result.ok) router.push(`/cases/${caseId}?job=1`);
      else setError(result.error);
    });
  }

  return (
    <form className="quick" onSubmit={handleSubmit} noValidate>
      <div className="case-chip">
        <b>{placeLabel}</b>
        <span className="caption">
          {caseNo}・{clientName}
        </span>
      </div>

      <div className="q">
        <div className="q-label">
          <span className="no">1</span>日付
        </div>
        <div className="seg" role="group" aria-label="日付">
          <button type="button" className="pick" aria-pressed={dateMode === "today"} onClick={() => setDateMode("today")}>
            今日
          </button>
          <button type="button" className="pick" aria-pressed={dateMode === "yesterday"} onClick={() => setDateMode("yesterday")}>
            昨日
          </button>
          <button type="button" className="pick" aria-pressed={dateMode === "pick"} onClick={() => setDateMode("pick")}>
            日付を選ぶ
          </button>
        </div>
        {dateMode === "pick" && (
          <input
            className="input"
            type="date"
            aria-label="施工日"
            value={pickedDate}
            max={today}
            onChange={(e) => setPickedDate(e.target.value)}
          />
        )}
      </div>

      <div className="q">
        <div className="q-label">
          <span className="no">2</span>工種<span className="req">必須</span>
        </div>
        <div className="picks three" role="group" aria-label="工種">
          {WORK_TYPES.map((w) => (
            <button key={w} type="button" className="pick center" aria-pressed={workType === w} onClick={() => setWorkType(w)}>
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="q">
        <div className="q-label">
          <span className="no">3</span>内容<span className="opt">任意・1行</span>
        </div>
        <input
          className="input"
          type="text"
          value={content}
          maxLength={200}
          onChange={(e) => setContent(e.target.value)}
          aria-label="内容"
          placeholder={workType === "その他" ? "何をしたかを1行で(工種がその他のとき)" : "例: 退去後クリーニング一式"}
        />
        {workType === "その他" && <p className="hint">工種で「その他」を選んだので、ここに何の作業かを書きます。</p>}
      </div>

      <div className="q">
        <div className="q-label">
          <span className="no">4</span>担当
        </div>
        <div className="seg" role="group" aria-label="担当">
          {ASSIGNEES.map((a) => (
            <button key={a} type="button" className="pick" aria-pressed={assignee === a} onClick={() => setAssignee(a)}>
              {a}
            </button>
          ))}
        </div>
        <p className="hint">区分だけを選びます。個人のお名前は入れません。</p>
      </div>

      <div className="q">
        <div className="q-label">
          <span className="no">5</span>手応え
        </div>
        <div className="seg" role="group" aria-label="手応え">
          {RATINGS.map((r) => (
            <button key={r.value} type="button" className="pick" aria-pressed={rating === r.value} onClick={() => setRating(r.value)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <details className="more">
        <summary>詳しく入れる(写真のURL・メモ)</summary>
        <div className="q" style={{ marginTop: "var(--sp-3)" }}>
          <label className="q-label" htmlFor="jq-photos">
            写真のURL<span className="opt">1行に1つ</span>
          </label>
          <textarea
            id="jq-photos"
            className="textarea"
            value={photoUrlsText}
            onChange={(e) => setPhotoUrlsText(e.target.value)}
            placeholder="https://..."
          />
          <p className="hint">管理会社のアプリ・LINE などにある写真の URL を貼ります(アップロードは次の段階)。</p>
        </div>
        <div className="q" style={{ marginTop: "var(--sp-3)" }}>
          <label className="q-label" htmlFor="jq-memo">
            メモ<span className="opt">任意</span>
          </label>
          <textarea id="jq-memo" className="textarea" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
      </details>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="quick-foot">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "記録中…" : "記録する"}
        </button>
      </div>
    </form>
  );
}
