"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createJobAction, updateJobAction } from "@/lib/data/actions-sites";
import { JOB_RATING_META, JOB_RATING_ORDER, type Job, type JobRating } from "@/lib/types";
import { todayISO } from "@/lib/format";

type Props = {
  siteId: string;
  /** 編集時のみ指定する */
  jobId?: string;
  initial?: Partial<
    Pick<Job, "job_date" | "work_type" | "content" | "assignee_name" | "photo_urls" | "rating" | "memo">
  >;
  submitLabel: string;
  onSuccess?: () => void;
  onCancel?: () => void;
};

/** 施工の登録・編集フォーム。「現場でスマホ1分」の粒度を優先し、必須項目は施工日と仕上がりのみ（SPEC.md §5） */
export function JobForm({ siteId, jobId, initial, submitLabel, onSuccess, onCancel }: Props) {
  const [jobDate, setJobDate] = useState(initial?.job_date ?? todayISO());
  const [workType, setWorkType] = useState(initial?.work_type ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [assigneeName, setAssigneeName] = useState(initial?.assignee_name ?? "");
  const [photoUrlsText, setPhotoUrlsText] = useState((initial?.photo_urls ?? []).join("\n"));
  const [rating, setRating] = useState<JobRating>(initial?.rating ?? "normal");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!jobDate) {
      setError("施工日を入力してください");
      return;
    }

    const photoUrls = photoUrlsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    const input = {
      siteId,
      jobDate,
      workType: workType || undefined,
      content: content || undefined,
      assigneeName: assigneeName || undefined,
      photoUrls,
      rating,
      memo: memo || undefined,
    };

    startTransition(async () => {
      const result = jobId ? await updateJobAction({ ...input, id: jobId }) : await createJobAction(input);
      if (result.ok) onSuccess?.();
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="jf-date">施工日</Label>
        <Input id="jf-date" type="date" value={jobDate} onChange={(e) => setJobDate(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jf-worktype">工種（任意）</Label>
        <Input
          id="jf-worktype"
          placeholder="例: クロス・床・水回り"
          value={workType}
          onChange={(e) => setWorkType(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jf-content">施工内容（任意）</Label>
        <Textarea
          id="jf-content"
          placeholder="内容を一言で"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jf-assignee">担当（任意）</Label>
        <Input
          id="jf-assignee"
          placeholder="担当者名・外注先など"
          value={assigneeName}
          onChange={(e) => setAssigneeName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jf-rating">仕上がり</Label>
        <Select value={rating} onValueChange={(v) => setRating(v as JobRating)}>
          <SelectTrigger id="jf-rating">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JOB_RATING_ORDER.map((r) => (
              <SelectItem key={r} value={r}>
                {JOB_RATING_META[r].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jf-photos">写真URL（1行に1つ・任意）</Label>
        <Textarea
          id="jf-photos"
          placeholder="https://..."
          value={photoUrlsText}
          onChange={(e) => setPhotoUrlsText(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          管理会社アプリ・LINE等にある写真のURLを貼り付けてください（アップロード機能は次段。PM決定 D38-7）
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="jf-memo">メモ（任意）</Label>
        <Textarea id="jf-memo" placeholder="気づいたことなど" value={memo} onChange={(e) => setMemo(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={pending}>
            キャンセル
          </Button>
        )}
        <Button type="submit" disabled={pending} className="flex-1">
          {pending ? "保存中…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
