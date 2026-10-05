# UI-FOUNDATION: UI の土台を何で組むか(WO-011 段階1・D81 の関所)

- 作成: 2026-10-04 / 作成: PoC の PL / 状態: **案(PM とユーザーが決めるまで、部品づくり=手順5 に進まない)**
- 比べるもの: 案1 shadcn/ui + Tailwind にトークン / 案2 SmartHR UI / 案3 デジタル庁デザインシステムの考え方を取り込む(部品は案1)
- 試作: `docs/ui-foundation-trials/index.html`(案件の一覧を1枚ずつ。画像は `ui-foundation-trials/screenshots/`)
- 確認元と取得日は §6。確認できなかった項目は「未確認」と書いた。推測で断定していない。

---

## 1. 結論(PL の推奨)

**案3 を推奨する。** 部品は今の shadcn/ui(Radix)+ Tailwind v4 で組み(案1)、デジタル庁デザインシステムから「考え方」を取り込む(フォーカスの輪・コントラストの基準・下線つきリンク・本文 16px)。表だけ TanStack Table(MIT)を足す案を、別枠で PM に諮る(§5)。

理由は3つ。
1. **案2 は、この土台に載せるのに手間と危険が大きい。**
   - SmartHR UI の依存に `styled-components ^5` と `tailwindcss ^3.4` がある。このアプリは Tailwind v4 + Next 15 の App Router。Next で styled-components を使うには、サーバー側でスタイルを集める仕組み(レジストリ)が要る。smarthr-ui 固有の手順は未確認。
   - 試作では描画できたが、(a) 375px で表の「状態」「金額」の列が画面の外に出て、カードに切り替わらなかった、(b) `createTheme` で主ボタンを深緑にしようとして、書き方が合わず青のままだった(上書きの正しいキーは未確認)。LP に載せる深緑×橙の顔にするには、テーマの調査が別に要る。
   - 見本4枚を作り直す手間が大きい(部品ごと SmartHR の見た目になる)。
2. **案1 は、段階0 で作った見本がそのまま設計図になる。** 追加の依存が無く、v1 の部品(Button・Input・Select・Dialog)とトークンの当て方も実績がある(`globals.css` の変数を差し替えるだけで v1 の画面も同じ顔になる)。
3. **案3 の「考え方だけ取り込む」は、費用がほぼ無く、アクセシビリティが上がる。** 試作3(案1に当てた形)で、フォーカスの二重の輪と下線つきリンクを足しても、ブランドの見た目は崩れない。デジタル庁の React 実装そのものは React 18 + Tailwind v3 前提で、Next.js の記載が無いため、部品としては取り込まない。

---

## 2. 比較表

観点は WO-011 の D81 のとおり。◎ 良い / ○ 可 / △ 手間か不安がある / ? 未確認。

| 観点 | 案1 shadcn + トークン | 案2 SmartHR UI | 案3 案1 + デジタル庁の考え方 |
|---|---|---|---|
| 日本語の業務画面との相性(表・フォーム・金額・日付) | ○ 表は TanStack Table で自作。金額・日付の入力は自作(標準に日本語向けは無い=未確認) | ◎ CurrencyInput(金額)・DatePicker・WarekiPicker・Table・StatusLabel・FormGroup が揃う | 案1と同じ。基準だけ足す |
| スマホ幅 | ◎ 見本どおり「表→カード」を自分で作れる(見本で375pxの確認済み) | △ 試作で375pxに表の列が収まらず、カードにならなかった。部品ごとのスマホ表示は未検証 | 案1と同じ |
| アクセシビリティ | ○ Radix の部品はキーボード・フォーカスに配慮。コントラストは見本で計算済み | ? 部品単位の基準は未確認 | ◎ フォーカスの二重の輪、4.5:1 / 3:1 の基準を明示して当てられる |
| ライセンス | MIT | MIT | 考え方は無償。トークンのパッケージ(`@digital-go-jp/design-tokens`)は MIT。**未改変で使うデジタル庁の素材は出典表記が要る**。ロゴの扱いは未確認 |
| 保守の活発さ | ◎ shadcn CLI は 2026-10-01 に更新。部品は自分のリポジトリにある=ライブラリの更新に引きずられない | ◎ 直近3か月に27回公開。ただしメジャー番号が速く進む(99.9.0)ので追従の費用が要る | ○ 案1と同じ(デジタル庁は v2.18.0、ベータ) |
| Next 15 + React 19 + Tailwind v4 との適合 | ◎ shadcn は Tailwind v4・React 19 に公式対応(v1 で稼働中) | △ React 19 は peer で可。styled-components v5 と Tailwind v3 の CSS を持つ。v4 との併用は未確認。RSC での動作は未検証 | ◎ 案1と同じ。デジタル庁の React 実装は React 18 + Tailwind v3 前提のため部品は取り込まない |
| DESIGN.md のトークンをどこまで当てられるか | ◎ 全部。見本が `tokens.css` で動いている | △ `createTheme` で色・余白・角などを上書きできるはずだが、試作で主ボタンの色が変わらなかった。状態の形(アイコン)や気づきの列も自作が要る | ◎ 全部+基準 |
| 見本4枚を作り直す手間 | ◎ ほぼ無い(HTML を React の部品に置き換えるだけ) | △ 大きい(部品が SmartHR の見た目になり、見本と別物になる) | ◎ 案1と同じ。フォーカスの輪などの CSS を足すだけ |
| LP に載せたときの見栄え | ◎ 深緑×橙の独自の顔。提案資料と揃う | ○ 整ってはいるが SmartHR 製品に似た見た目になる。試作の表の見た目は良好 | ◎ 案1と同じ |
| 追加の依存 | 表をやるなら TanStack Table(MIT)を1つ(§5) | smarthr-ui 本体(unpacked 約 13.5MB)+ styled-components + react-intl | 案1と同じ。トークンは値を写すだけで、パッケージは入れない |

---

## 3. 試作の見方(案件の一覧を1枚ずつ)

`python -m http.server 4174 --bind 127.0.0.1 --directory poc-app/docs` を実行して http://127.0.0.1:4174/ui-foundation-trials/index.html を開く。

| 案 | ファイル | 何を作ったか | 注意 |
|---|---|---|---|
| 案1 | `case1-shadcn-tokens.html` | DESIGN.md の見本(案件の一覧)そのもの | **shadcn の部品を実際に描画したものではない。** 見本の CSS(`tokens.css`)で、Tailwind + shadcn で組んだときの見た目を再現している。実装では Button・Input・Select を shadcn の部品に置き換える |
| 案2 | `case2-smarthr/`(Vite でビルドした静的ページ) | **smarthr-ui 99.9.0 を実際に描画。** Table・StatusLabel・SearchInput・Select・Button・FormControl を使い、表まわりだけを作った | 左のメニューと「要対応」のまとめは作っていない=**表まわりだけの比較**。色の上書き(`createTheme`)は試したが主ボタンは青のまま。上書きの正しい書き方は未確認で、公平を期すなら調べ直しの余地がある |
| 案3 | `case3-dads-ideas.html` | 案1に、デジタル庁の考え方(フォーカスの黄+黒の二重の輪、下線つきリンク、見出しの文字色を濃く、入力欄の枠を濃く)を足したもの | 値は `@digital-go-jp/design-tokens` 2.0.1 の yellow-300(`#ffd43d`)と neutral-solid-gray-900(`#1a1a1a`) |

画像:
- PC: `screenshots/case1-pc.png`・`case2-pc.png`・`case3-pc.png`
- スマホ(375px の枠の中): `screenshots/case1-sp.png`・`case2-sp.png`・`case3-sp.png`

見たところ(事実):
- 案2は PC で表が見やすく、StatusLabel(期日超過=赤、請求が未作成=黄)が使える。スマホ幅(375px)では、表の「発注元」「受付日」までしか見えず、「状態」「金額」「気づき」の列が画面の外に出る(カードには切り替わらない)。
- 案1・案3は、スマホ幅で表がカードに切り替わり、横スクロールが出ない。

---

## 4. 案ごとの手間と危険

### 案1(段階0 の前提)
- 手間: 小。トークンは `globals.css` の変数に写す(`:root` を深緑×橙に差し替えると v1 の画面も同じ顔になる)。表・フィルター・状態のラベルは自作の部品にする(見本が設計図)。
- 危険: 自作の部品が増える。アクセシビリティは自分で守る。
- 残るもの: shadcn の `ui/*`(Button・Dialog・Select・Input)、lucide-react、v1 の画面。

### 案2
- 手間: 中〜大。styled-components のレジストリ、Tailwind v3 の CSS との共存、テーマの上書き、スマホのカード化、見本4枚の作り直し。
- 危険: メジャー版が速い(99.9.0。直近3か月で 97→99 に進んだ)ため追従の費用がかかる。Tailwind v4 との併用が未確認。実装の途中で行き詰まると、案1に戻す手間が二重にかかる。
- 得るもの: 金額・和暦などの日本語向け部品、StatusLabel、実績のある表。

### 案3
- 手間: 案1 + 小(CSS の追加と、基準を DESIGN.md に書く)。
- 危険: ほぼ無い。デジタル庁の素材を**そのまま**使う場合だけ、出典表記が要る(考え方の参考だけなら不要。素材・ロゴは写さない)。

---

## 5. PM に諮ること

1. **土台は案3(案1 + 考え方)でよいか。**
2. **表の部品として TanStack Table(`@tanstack/react-table`・MIT・React 18 以上)を足してよいか。** WO のとおり、足すライブラリは名前・ライセンス・理由を上げる。
   - 理由: 一覧のソート・フィルター・段階4 の集計表で、ソートや並べ替えの状態管理を自作すると長くなる。shadcn の Data Table も TanStack Table が前提。
   - 足さない場合: 段階1 の物件の一覧は、サーバー側で並べ替えと絞り込みをして、素の `<table>` で出す(件数が数十件の規模)。
3. **日付・金額の入力**は、段階2〜3 で必要になったときに、その場で提案する(今は決めない)。
4. 案2を選ぶ場合の追加調査(RSC での動作、テーマの上書き、Tailwind v4 との併用、スマホのカード化)を、PM がどこまで求めるか。

---

## 6. 確認元(すべて取得日 2026-10-04。調査は別の作業者が `npm view`・`npm pack` と各公式ページで行い、PL が試作で一部を再確認)

- SmartHR UI: https://github.com/kufu/smarthr-ui / https://github.com/kufu/smarthr-ui/releases / https://www.npmjs.com/package/smarthr-ui(99.9.0、2026-10-01、MIT。peer は React ^18 || ^19、styled-components ^5.0.1、react-intl。依存に tailwindcss ^3.4.19)
- SmartHR Design System(トークンの考え方): https://smarthr.design/products/design-tokens/
- デジタル庁デザインシステム: https://design.digital.go.jp/dads/ / https://design.digital.go.jp/introduction/notices/(v2.18.0 ベータ。フォーカスは黄+黒の二重構造、コントラストは文字 4.5:1・部品の境界 3:1)
- デジタル庁の React 実装: https://github.com/digital-go-jp/design-system-example-components-react(MIT、React ^18.3.1、tailwindcss ^3.4.19、react-aria-components。React 19 は検討中、Next.js の記載なし)
- デジタル庁のトークン: npm `@digital-go-jp/design-tokens` 2.0.1(MIT)、`@digital-go-jp/tailwind-theme-plugin` 1.0.1(MIT。peer は tailwindcss ^3.4.17 || ^4.0.0。**v4 で実際に動くかは未検証**)
- shadcn/ui: https://ui.shadcn.com/docs/tailwind-v4 / https://ui.shadcn.com/docs/components/data-table / https://ui.shadcn.com/docs/theming(MIT。Tailwind v4・React 19 に対応。Data Table は TanStack Table で自作するガイド)
- 参考(試作はしていない): Mantine 9.6.3(MIT)・React Aria Components 1.21.1(Apache-2.0)・Ant Design 6.6.5(MIT)・MUI 9.4.0(MIT)・Radix Themes 3.3.0(MIT)。日本語業務画面での実績は調べていない。

**未確認**: smarthr-ui の Next 15 App Router での動作と公式の導入手順/Tailwind v4 との併用/ビルド後のサイズ/部品ごとのスマホ表示/テーマ上書きの正しい書き方、デジタル庁トークンの公開形式の公式説明・ロゴ使用の詳細・Tailwind v4 での動作、shadcn の日本語向け部品とスマホ対応、各ライブラリの日本語業務画面での導入実績。

---

## 7. 決まったあと(手順5 以降の動き)

- 案3: `globals.css` に DESIGN.md のトークンを当て、部品を `src/components/ui/` に整える。物件の一覧・詳細・登録を組む。地図とチラシ配布の撤去(手順6)。
- 案2: 追加調査(§5 の4)を先に行い、土台の組み替えに入る前に再度止まる。
