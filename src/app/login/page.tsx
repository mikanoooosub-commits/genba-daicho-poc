"use client";

import { useEffect, useState } from "react";
import { MapPin, Mail, CheckCircle2, FlaskConical, KeyRound } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { disableDemoMode, enableDemoMode, readDemoMode } from "@/lib/demo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [mode, setMode] = useState<"password" | "magic">("password");

  // デモ表示モード（DB の参照先を demo スキーマに切り替える）
  const [useDemo, setUseDemo] = useState(false);

  // パスワードログイン
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "loading" | "error">("idle");
  const [pwMessage, setPwMessage] = useState("");

  // マジックリンク
  const [magicEmail, setMagicEmail] = useState("");
  const [magicStatus, setMagicStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [magicMessage, setMagicMessage] = useState("");

  // 実際の cookie に初期状態を合わせる。
  // マウント後に読むのは、サーバー描画と初期 state を一致させて hydration のズレを避けるため。
  useEffect(() => {
    setUseDemo(readDemoMode());
  }, []);

  function handleDemoToggle(checked: boolean) {
    setUseDemo(checked);
    // 押した時点で cookie に反映しておく。ログイン後のリダイレクト先を
    // サーバーが描画する時点で、すでに参照スキーマが決まっている必要があるため。
    if (checked) enableDemoMode();
    else disableDemoMode();
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setPwStatus("loading");
    setPwMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      window.location.href = "/";
    } catch (err) {
      setPwStatus("error");
      const raw = err instanceof Error ? err.message : "";
      setPwMessage(
        /invalid login credentials/i.test(raw)
          ? "メールアドレスまたはパスワードが違います。"
          : raw || "ログインに失敗しました。"
      );
    }
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!magicEmail.trim()) return;
    setMagicStatus("sending");
    setMagicMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: magicEmail.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      });
      if (error) throw error;
      setMagicStatus("sent");
    } catch (err) {
      setMagicStatus("error");
      const raw = err instanceof Error ? err.message : "";
      setMagicMessage(
        /signup|not allowed|not found|disabled/i.test(raw)
          ? "このメールアドレスは登録されていません。管理者に招待を依頼してください。"
          : raw || "送信に失敗しました。"
      );
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 py-10">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <MapPin className="size-7" />
        </span>
        <div>
          <h1 className="text-xl font-extrabold">現場台帳(PoC)</h1>
          <p className="text-sm text-muted-foreground">
            現場ごとの施工・請求・入金を、地図と台帳で。
          </p>
        </div>
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            {mode === "password" ? (
              <>
                <KeyRound className="size-5" />
                パスワードでログイン
              </>
            ) : (
              <>
                <Mail className="size-5" />
                メールリンクでログイン
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mode === "password" ? (
            <form onSubmit={handlePasswordLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">メールアドレス</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">パスワード</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="パスワード"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {pwStatus === "error" && <p className="text-sm text-destructive">{pwMessage}</p>}
              <Button type="submit" size="lg" disabled={pwStatus === "loading"}>
                {pwStatus === "loading" ? "ログイン中…" : "ログイン"}
              </Button>
              <button
                type="button"
                onClick={() => setMode("magic")}
                className="text-center text-xs font-bold text-primary hover:underline"
              >
                初回の方・パスワード未設定の方はこちら（メールでログイン）
              </button>
            </form>
          ) : magicStatus === "sent" ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="size-10 text-rating-good" />
              <p className="text-sm font-bold">ログインリンクを送信しました</p>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{magicEmail}</span> 宛のメールを開き、
                リンクをタップしてください。
                <br />
                ※ リンクは<strong>リクエストしたのと同じブラウザ</strong>で開いてください。
              </p>
              <Button variant="ghost" size="sm" onClick={() => setMode("password")}>
                パスワードログインに戻る
              </Button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="magic-email">メールアドレス</Label>
                <Input
                  id="magic-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={magicEmail}
                  onChange={(e) => setMagicEmail(e.target.value)}
                  required
                />
              </div>
              {magicStatus === "error" && <p className="text-sm text-destructive">{magicMessage}</p>}
              <Button type="submit" size="lg" disabled={magicStatus === "sending"}>
                {magicStatus === "sending" ? "送信中…" : "ログインリンクを送る"}
              </Button>
              <button
                type="button"
                onClick={() => setMode("password")}
                className="text-center text-xs font-bold text-primary hover:underline"
              >
                パスワードでログインに戻る
              </button>
              <p className="text-center text-xs text-muted-foreground">
                ログイン後、右上メニューからパスワードを設定できます。
              </p>
            </form>
          )}
        </CardContent>
      </Card>

      {/* デモ表示モード: DB の参照先を demo スキーマに切り替える（本番データは表示されない） */}
      <label className="mt-4 flex w-full cursor-pointer items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
        <input
          type="checkbox"
          checked={useDemo}
          onChange={(e) => handleDemoToggle(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-amber-500"
        />
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-bold">
            <FlaskConical className="size-4 text-amber-600" />
            デモデータを参照する
          </span>
          <span className="text-xs text-muted-foreground">
            架空のダミーデータに切り替えて表示します。本番データは表示されません。
          </span>
        </span>
      </label>
    </div>
  );
}
