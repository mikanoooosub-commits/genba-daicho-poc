import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";


/** レスポンスがPostgRESTの `PGRST303`(JWT issued in future)エラーかどうかを判定する */
async function isPgrst303(response: Response): Promise<boolean> {
  try {
    // .clone() で読む: 元の response は呼び出し元(supabase-js内部)がそのまま消費するため、
    // ここで読み捨ててしまうとボディが空になってしまう。
    const body: unknown = await response.clone().json();
    return (
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      (body as { code?: unknown }).code === "PGRST303"
    );
  } catch {
    return false;
  }
}

/**
 * ISSUE-001対応: 初回ログイン直後、発行直後のJWTの`iat`(発行時刻)とDBサーバー側の時計に
 * ごく僅かな差があると、PostgRESTが `PGRST303`(JWT issued in future)を返してリクエストが
 * 500になることがある(数百ms後には解消する一過性のエラー。テスト役が実サーバーログで再現を
 * 確認済み)。`global.fetch`をこの薄いラッパーに差し替え、PGRST303を検出したときだけ
 * セッションを取り直し(`auth.refreshSession()`)、同じリクエストを新しいアクセストークンで
 * 1回だけ再試行する。再試行後にまた失敗しても、それ以上は追跡しない(無限リトライ禁止)。
 * 検出時はサーバーログに1行残す(原因調査用)。
 *
 * `getClient`を遅延参照にしているのは、この関数自体がSupabaseクライアント生成時の
 * `global.fetch`オプションに渡すため、クライアント本体より先に必要になるため
 * （クライアント生成後に参照を差し込む）。
 */
function createPgrst303RetryingFetch(getClient: () => SupabaseClient | null): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    if (!response.ok && (await isPgrst303(response))) {
      console.warn(
        "[supabase] PGRST303 (JWT issued in future) を検出。セッションを再取得して1回だけリトライします。"
      );
      const client = getClient();
      if (client) {
        const { data, error } = await client.auth.refreshSession();
        const accessToken = data.session?.access_token;
        if (!error && accessToken) {
          const headers = new Headers(init?.headers);
          headers.set("Authorization", `Bearer ${accessToken}`);
          return fetch(input, { ...init, headers });
        }
      }
    }
    return response;
  };
}

/**
 * サーバー（Server Component / Route Handler / Server Action）用 Supabase クライアント。
 *
 * 参照スキーマは public 固定(デモ表示モードは D79-3 で外した)。
 */
export async function createClient() {
  const cookieStore = await cookies();
  // PGRST303リトライ用フェッチがクライアント自身(auth.refreshSession)を参照できるよう、
  // 生成後にこの変数へ差し込む(クライアント生成の時点ではまだ実体が無いため)。
  let client: SupabaseClient | null = null;

  client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: "public" },
      global: { fetch: createPgrst303RetryingFetch(() => client) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component からの呼び出しでは cookie を書き込めないが、
            // セッション更新は middleware が担うため無視してよい。
          }
        },
      },
    }
  );

  return client;
}
