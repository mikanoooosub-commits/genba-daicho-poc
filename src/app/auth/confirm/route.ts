import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

/**
 * マジックリンクのリダイレクト先。
 * PKCE の `code`、または `token_hash`+`type` のどちらの形式でも受けられるようにしておく。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (tokenHash) {
    // メールテンプレートの type 値の差異（email / magiclink）に耐えるよう、
    // 指定 type で失敗したらもう片方でも試す。
    const primary = (type ?? "email") as EmailOtpType;
    let result = await supabase.auth.verifyOtp({ type: primary, token_hash: tokenHash });
    if (result.error && (primary === "email" || primary === "magiclink")) {
      const alt = (primary === "email" ? "magiclink" : "email") as EmailOtpType;
      result = await supabase.auth.verifyOtp({ type: alt, token_hash: tokenHash });
    }
    if (!result.error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
