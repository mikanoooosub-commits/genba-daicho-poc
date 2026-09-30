/**
 * デモ表示モードの共有定義。
 *
 * サーバー（Supabase クライアントの参照スキーマ切替）とクライアント（ログイン画面の
 * チェックボックス、デモ中バナー）の両方から使うため、`next/headers` に依存しない
 * このファイルに切り出している。
 *
 * 注意: デモ表示モードはセキュリティ境界ではない。利用者が任意に切り替えられる利便
 * スイッチであり、本番データを守っているのは「demo スキーマに本番の行が物理的に
 * 存在しないこと」であって、この cookie ではない。
 */

/** デモ表示モードを保持する cookie 名。値が "1" のとき demo スキーマを参照する */
export const DEMO_COOKIE = "demo_mode";

/** cookie の保持期間（30日） */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** デモ表示モードを有効化する（ブラウザからのみ呼ぶ） */
export function enableDemoMode(): void {
  document.cookie = `${DEMO_COOKIE}=1; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

/** デモ表示モードを解除する（ブラウザからのみ呼ぶ） */
export function disableDemoMode(): void {
  document.cookie = `${DEMO_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/**
 * 現在デモ表示モードかを cookie から読む（ブラウザからのみ呼ぶ）。
 * チェックボックスの初期状態を実際の cookie に合わせるために使う。
 */
export function readDemoMode(): boolean {
  return document.cookie
    .split("; ")
    .some((c) => c === `${DEMO_COOKIE}=1`);
}
