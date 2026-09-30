"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/types";

/**
 * 論理削除の確認ダイアログ。理由メモ入力を必須にする(PM決定D38-3: 訂正は論理削除+
 * 理由メモ必須。マイナス行は使わない)。請求・入金の両方から使う共通部品。
 */
export function DeleteReasonDialog({
  title,
  description,
  triggerLabel = "取り消す",
  onConfirm,
  onDone,
}: {
  title: string;
  description?: string;
  triggerLabel?: string;
  onConfirm: (reason: string) => Promise<ActionResult>;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    setError("");
    if (!reason.trim()) {
      setError("取消理由を入力してください");
      return;
    }
    startTransition(async () => {
      const result = await onConfirm(reason.trim());
      if (result.ok) {
        setOpen(false);
        setReason("");
        onDone?.();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setReason("");
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-destructive">
          <Trash2 className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="delete-reason">取消理由（必須）</Label>
          <Textarea
            id="delete-reason"
            placeholder="例: 金額を入力し間違えたため取り消し、正しい金額で登録し直す"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="flex-1"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "処理中…" : "取り消す"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
