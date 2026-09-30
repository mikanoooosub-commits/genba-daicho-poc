# deploy-runbook — 現場台帳(PoC)の公開手順

**値(キー・パスワード)はこの文書に書かない。環境変数は名前と設定先だけ。**
理由: リポジトリに秘密が入ると、履歴に残って消せなくなるため。

## 1. 構成
| 役割 | サービス | 置くもの |
|---|---|---|
| コード | GitHub(**private**、リポジトリ名 `genba-daicho-poc`) | `poc-app/` の中身(リポジトリのルートが poc-app) |
| 配信 | Vercel(Next.js 15) | GitHub の main を自動でビルド・公開 |
| 認証・DB | Supabase | 既存のプロジェクト(スキーマ・データは今回変えない) |

## 2. 環境変数(Vercel → Project Settings → Environment Variables)
| 名前 | 設定先 | 値の出どころ |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production・Preview | 自分の `.env.local` から写す |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production・Preview | 同上(anon key まで。`service_role` は入れない) |

名前を打ち間違える/入れ忘れると、本番はログイン画面ではなく「設定が不足しています」(500)になる(意図した動作)。

## 3. 初回デプロイの順序(順番を変えない)
1. GitHub に private リポジトリを作り、`poc-app` を push する(`git push` のみ。force push はしない)。
2. **Supabase でサインアップを止める**: Authentication → Sign In / Providers(Sign In / Up)→「Allow new users to sign up」をオフ。
   理由: RLS は「ログイン済みなら全件読める」設計で、anon キーは公開される。サインアップが開いていると第三者が登録して読める。**止めるまで Vercel に進まない。**
3. Vercel で「Add New → Project」→ GitHub のリポジトリを取り込み、環境変数2つを入れて Deploy。
4. 発行された URL を Supabase の Authentication → URL Configuration に登録する。
   - Site URL: 公開 URL
   - Redirect URLs: 公開 URL(`/auth/confirm` を含む形。例: `<公開URL>/auth/confirm`、必要なら `<公開URL>/**`)
   理由: メール(OTP・再設定)の戻り先が localhost のままだと公開 URL で使えない。
5. 公開 URL でログインして動作確認(`docs/test-scenarios.md` の C-9)。

## 4. やり直し
- コードの再デプロイ: main に push すれば自動。失敗したら Vercel の Deployments で前のデプロイを「Promote to Production」で戻せる。
- 環境変数を変えたら Vercel で **Redeploy が必要**(変数は次のビルドから効く)。
- ローカルでの本番ビルド確認: dev サーバーを止めてから `npm run build`(dev と `.next` を取り合うため。`poc-app/CLAUDE.md` 参照)。

## 5. 運用上の注意
- Supabase の無料プランは **約1週間使わないと一時停止**する。研修の前日に一度ログインして開いておく。停止していたら Supabase のダッシュボードから Restore する。
- 公開 URL は検索に載らない設定(noindex)だが、URL を知っていればログイン画面までは開ける。データはログインしないと見えない。
- 招待するユーザーは Supabase の Authentication → Users から追加する(サインアップは止めているため)。

## 6. 止めるとき
1. Vercel: プロジェクトの Settings → General から削除、または Domains を外す(公開が止まる)。
2. Supabase: プロジェクトの Settings → General → Pause project(一時停止。復元可能)。
3. 念のため GitHub リポジトリが private のままであることを確認する。
