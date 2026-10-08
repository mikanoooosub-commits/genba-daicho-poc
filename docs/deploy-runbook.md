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

## 7. 入れ替えの記録
| 日 | 内容 | コミット | 戻し先 |
|---|---|---|---|
| 2026-10-06 | v1(地図つき)から v2(物件・案件の台帳)に入れ替え(`rebuild` を `main` に早送りでマージ。D92)。DB は migration_005〜007 を適用済みで、戻さない(足すだけ) | `a80cacf` | 直前の Production = `4e29e0d`(v1)。Vercel の Deployments で「Promote to Production」 |
| 2026-10-06 | 段階3(見積・原価・粗利・見積書の印刷・事業者情報)に入れ替え(`stage3` を `main` に早送りでマージ。D100)。DB は migration_008・009 を適用済みで、戻さない(足すだけ) | `ceaa5a4` | 直前の Production = `186838b`(v2 の段階2)。Vercel の Deployments で「Promote to Production」 |
| 2026-10-07 | 見た目の入れ替え(WO-012・縛りなし案 v2 の採用。案B+表は案A。D111): 橙の主ボタン・一覧の頭の深緑の面と「次の一手」の列・詳細の「次にやること」と粗利の面・見積の保存と提出の位置・登録(スマホ)の進み・スマホの下ナビ4項目(「その他」=`/more`)・`/design`。`design` を `main` に早送りでマージ。**DB は変えていない**(読み取りの `getCaseCounts` に合計を足しただけ)。**書き込みを伴う流れ(S1〜S3)は PL は未実行**(HANDOVER.md §4) | `c9d71aa`(コード。文書の追加を含むコミットが後ろに続く) | 直前の Production = `f84586a`(段階3の版)。Vercel の Deployments で「Promote to Production」。DB は戻さない |
| 2026-10-08 | 見積の下書きの不具合の修正(PL-004・ISSUE-012〜014): 保存のエラーを、ボタンの行の左の1か所にハイライトで出す・未保存のあいだは「見積書を見る・印刷」を押せなくする・ページを離れる警告・4つのボタンを1行に・1280px 未満で入力表が潰れる問題を直す。`fix/estimate-draft` を `main` に早送りでマージ(ユーザーの了承)。**DB は変えていない**。保存の成功・提出は PL は未確認(DB に書き込まない試験用ページで確認) | `a232d0f` | 直前の Production = `6a02d3a`。Vercel の Deployments で「Promote to Production」 |
