"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, KeyRound } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function AccountMenu() {
  const router = useRouter();

  async function handleLogout() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <div className="flex items-center">
      <PasswordDialog />
      <Button
        variant="ghost"
        size="icon"
        onClick={handleLogout}
        aria-label="ログアウト"
        title="ログアウト"
      >
        <LogOut className="size-5" />
      </Button>
    </div>
  );
}

function PasswordDialog() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    if (password.length < 6) {
      setStatus("error");
      setMessage("パスワードは6文字以上にしてください。");
      return;
    }
    if (password !== confirm) {
      setStatus("error");
      setMessage("確認用パスワードが一致しません。");
      return;
    }
    setStatus("saving");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus("done");
      setPassword("");
      setConfirm("");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "設定に失敗しました。");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setStatus("idle");
          setMessage("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="パスワード設定" title="パスワード設定">
          <KeyRound className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>パスワードを設定・変更</DialogTitle>
        </DialogHeader>
        {status === "done" ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm font-bold text-rating-good">パスワードを設定しました。</p>
            <p className="text-sm text-muted-foreground">
              次回から、このパスワードでログインできます。
            </p>
            <Button onClick={() => setOpen(false)}>閉じる</Button>
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              メール＋パスワードでログインできるようになります。
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">新しいパスワード</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                placeholder="6文字以上"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password">確認用（もう一度）</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            {status === "error" && <p className="text-sm text-destructive">{message}</p>}
            <Button type="submit" disabled={status === "saving"}>
              {status === "saving" ? "設定中…" : "パスワードを設定"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
