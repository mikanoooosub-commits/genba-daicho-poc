import { AlertOctagon, FileWarning, Info, Plus, Clock } from "lucide-react";

import { StatusLabel, type StatusTone } from "@/components/status-label";
import "./design.css";

// スタイルガイド(生きた見本)。docs/DESIGN-SYSTEM.md の部品を実物で並べる。
// ログインが要る画面。データはすべて架空で、DB には触らない(静的な見本だけ)。
// 部品の見た目の正は src/app/v2.css。ここで見た目を決めない(見本の枠は design.css)。

export const metadata = { title: "スタイルガイド | 現場台帳" };

const SECTIONS = [
  ["colors", "色"],
  ["type", "文字"],
  ["space", "余白・角・影"],
  ["buttons", "ボタン"],
  ["status", "状態と気づき"],
  ["forms", "フォーム"],
  ["picks", "選ぶボタン"],
  ["filters", "フィルター"],
  ["table", "表とスマホのカード"],
  ["notices", "お知らせ・空の状態"],
  ["flow", "案件の流れ"],
  ["nav", "ナビ"],
] as const;

const COLORS: { group: string; items: [string, string, string][] }[] = [
  {
    group: "面と文字",
    items: [
      ["--bg", "#F5F7F6", "画面の地"],
      ["--surface", "#FFFFFF", "カード・表・入力欄"],
      ["--surface-sunken", "#EEF2F1", "表の見出し行"],
      ["--ink", "#1A2226", "本文(16.1:1)"],
      ["--ink-muted", "#44514F", "補足(8.3:1)"],
      ["--ink-faint", "#636F6D", "入力例だけ(5.2:1)"],
      ["--line", "#D7DEDD", "区切りの線(飾り)"],
      ["--line-strong", "#6F7E7C", "入力欄の枠(4.2:1)"],
    ],
  },
  {
    group: "基調と差し色",
    items: [
      ["--primary", "#0F3B36", "主ボタン・選択中・メニュー"],
      ["--primary-hover", "#1B554C", "主ボタンのホバー"],
      ["--primary-soft", "#E3EEEB", "選択中の地"],
      ["--link", "#0F5F55", "リンク(7.5:1)"],
      ["--brand-accent", "#C1752F", "飾りと要対応の帯だけ。文字には使わない"],
      ["--accent-strong", "#7C420E", "橙の文字(8.0:1)"],
      ["--accent-soft", "#FCEBD5", "橙の地"],
    ],
  },
  {
    group: "状態(地と文字)",
    items: [
      ["--st-neutral-bg", "#ECEFEF", "依頼・見積中・失注の地"],
      ["--st-progress-bg", "#E3EEEB", "受注・施工中・完了の地"],
      ["--st-info-bg", "#E2ECF7", "請求済・未入金の地"],
      ["--st-good-bg", "#DDF0E3", "入金済の地"],
      ["--st-warn-bg", "#FCEBD5", "請求が未作成の地"],
      ["--st-danger-bg", "#FBE6DE", "期日超過の地"],
      ["--st-info-fg", "#1F4A80", "青の文字(7.5:1)"],
      ["--st-good-fg", "#1B5733", "緑の文字(7.2:1)"],
      ["--st-warn-fg", "#7A3E0A", "橙の文字(7.1:1)"],
      ["--st-danger-fg", "#8E2A0E", "赤茶の文字(7.0:1)"],
      ["--danger-solid", "#93301A", "取り消しの枠・件数の丸"],
    ],
  },
];

const TYPE_SCALE: [string, string, string, string][] = [
  ["h1 画面の見出し", "var(--fs-h1)", "700", "案件"],
  ["h2 区画の見出し", "var(--fs-h2)", "700", "請求・入金"],
  ["h3 小見出し", "var(--fs-h3)", "700", "原価と粗利(税抜)"],
  ["本文・入力欄 16px", "var(--fs-body)", "400", "依頼から入金まで、1件の仕事を1行で見ます。"],
  ["表(PC) 15px", "var(--fs-dense)", "400", "グリーンコーポ板橋 305-A"],
  ["補足・注記 14px(最小)", "var(--fs-caption)", "400", "税込の金額です。入居者のお名前は入れません。"],
  ["合計の数字 28px", "var(--fs-num-xl)", "700", "¥223,000"],
];

const TONES: [StatusTone, string][] = [
  ["neutral", "依頼"],
  ["neutral", "見積中"],
  ["progress", "受注"],
  ["progress", "施工中"],
  ["progress", "完了"],
  ["info", "請求済"],
  ["good", "入金済"],
  ["lost", "失注"],
];

export default function DesignPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>スタイルガイド</h1>
          <p className="sub">部品とトークンを実物で並べた見本です。文書は docs/DESIGN-SYSTEM.md。データはすべて架空です。</p>
        </div>
      </div>

      <ul className="sg-toc" aria-label="この画面の目次">
        {SECTIONS.map(([id, label]) => (
          <li key={id}>
            <a className="btn btn-secondary" href={`#${id}`}>
              {label}
            </a>
          </li>
        ))}
      </ul>

      <section id="colors" className="sg-section">
        <h2>色</h2>
        <p className="lead">
          色は「役割」で選ぶ。状態の色には、必ず形の違うアイコンと文字を添える(色だけに頼らない)。橙(--brand-accent)は白地で 3.6:1 しかないので、文字には使わない。
        </p>
        <div className="sg-stack">
          {COLORS.map((g) => (
            <div key={g.group}>
              <h3>{g.group}</h3>
              <div className="sg-grid">
                {g.items.map(([name, value, use]) => (
                  <div key={name} className="sg-swatch">
                    <div className="chip-color" style={{ background: `var(${name})` }} />
                    <span className="name sg-code">{name}</span>
                    <span className="val">
                      {value}・{use}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="type" className="sg-section">
        <h2>文字</h2>
        <p className="lead">
          最小は 14px。入力欄は 16px 未満にしない(iPhone で画面が拡大される)。数字は等幅(.num)にして、表では右に揃える。書体は端末のゴシックで、Web フォントは読み込まない。
        </p>
        <dl className="card card-pad sg-type">
          {TYPE_SCALE.map(([label, size, weight, sample]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt>{label}</dt>
              <dd style={{ fontSize: size, fontWeight: Number(weight) }}>{sample}</dd>
            </div>
          ))}
          <dt>数字(.num)</dt>
          <dd>
            <span className="num">¥1,234,500</span>
            <br />
            <span className="num">¥ 765,400</span>
            <span className="sg-note">　← 桁がそろう(等幅)</span>
          </dd>
        </dl>
      </section>

      <section id="space" className="sg-section">
        <h2>余白・角・影</h2>
        <p className="lead">余白は 4px 刻み(1・2px の微調整は例外)。カードの内側は 24px、スマホは 16px。押す場所は 44px 以上、スマホ1分の入力は 56px 以上。</p>
        <div className="card card-pad sg-stack">
          <div className="sg-space" aria-label="余白の段階">
            {[
              ["--sp-1", 4],
              ["--sp-2", 8],
              ["--sp-3", 12],
              ["--sp-4", 16],
              ["--sp-5", 24],
              ["--sp-6", 32],
              ["--sp-7", 48],
            ].map(([name, px]) => (
              <div key={name}>
                <div className="bar" style={{ height: `var(${name})` }} />
                <span className="sg-note">
                  {name}
                  <br />
                  {px}px
                </span>
              </div>
            ))}
          </div>
          <div className="sg-row">
            <div className="sg-box" style={{ borderRadius: "var(--r-sm)" }}>
              --r-sm 4px
            </div>
            <div className="sg-box" style={{ borderRadius: "var(--r-md)" }}>
              --r-md 8px
            </div>
            <div className="sg-box" style={{ borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-1)" }}>
              --r-lg 12px
              <br />
              --shadow-1
            </div>
            <div className="sg-box" style={{ borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-2)", border: 0 }}>
              --shadow-2
            </div>
          </div>
        </div>
      </section>

      <section id="buttons" className="sg-section">
        <h2>ボタン</h2>
        <p className="lead">1つの画面に、主のボタンは1つだけ。文字は「何が起きるか」を動詞で書く(「登録する」「完了にする」。「OK」「はい」は使わない)。</p>
        <div className="card sg-demo sg-stack">
          <div className="sg-row">
            <button type="button" className="btn btn-primary">
              <Plus className="icon" aria-hidden="true" />
              案件を登録
            </button>
            <button type="button" className="btn btn-secondary">
              見積書を見る
            </button>
            <button type="button" className="btn btn-ghost">
              変更履歴
            </button>
            <button type="button" className="btn btn-danger">
              この案件を取り消す
            </button>
            <button type="button" className="btn btn-primary" disabled>
              登録する(入力がそろうまで押せない)
            </button>
          </div>
          <p className="sg-note">
            主=.btn-primary(深緑)/ 副=.btn-secondary(白地+深緑の枠)/ 文字だけ=.btn-ghost / 取り消し=.btn-danger(白地+赤茶の枠。押すと理由つきの確認を出す)。小さい版(.btn-sm)は廃止した(押す場所は 44px 以上)。
          </p>
        </div>
      </section>

      <section id="status" className="sg-section">
        <h2>状態と気づき</h2>
        <p className="lead">
          状態のラベルは、1つの案件に1つだけ。「期日超過 23日」のように対象ごとに値が違うものは、ラベルにせず「気づき」として文字とアイコンで別の場所に出す。
        </p>
        <div className="card sg-demo sg-stack">
          <div className="sg-row">
            {TONES.map(([tone, label]) => (
              <StatusLabel key={label} tone={tone}>
                {label}
              </StatusLabel>
            ))}
          </div>
          <div className="sg-row">
            <span className="flag flag-warn">
              <FileWarning className="icon" aria-hidden="true" />
              請求が未作成
            </span>
            <span className="flag flag-danger">
              <AlertOctagon className="icon" aria-hidden="true" />
              期日超過 23日
            </span>
            <span className="flag flag-info">
              <Clock className="icon" aria-hidden="true" />
              期日まで 7日
            </span>
          </div>
          <p className="sg-note">
            色の意味: 青=お金を待っている / 緑=済んだ / 橙=人の作業が要る / 赤茶=期限を過ぎた。白黒で印刷しても、アイコンの形と文字で区別できる。
          </p>
        </div>
      </section>

      <section id="forms" className="sg-section">
        <h2>フォーム</h2>
        <p className="lead">項目名は入力欄の上。必須は赤茶の「必須」、任意は灰色の「任意」と文字で書く。誤りは欄の下に「何を直せばよいか」を書く。</p>
        <div className="card card-pad sg-stack" style={{ maxWidth: 560 }}>
          <div className="field">
            <label htmlFor="sg-name">
              物件名<span className="req">必須</span>
            </label>
            <input id="sg-name" className="input" placeholder="例: さくらマンション" />
            <span className="hint">戸籍の名前ではなく、建物の名前を入れます。</span>
          </div>
          <div className="field">
            <label htmlFor="sg-err">
              工種<span className="req">必須</span>
            </label>
            <input id="sg-err" className="input" aria-invalid="true" aria-describedby="sg-err-msg" defaultValue="" />
            <span id="sg-err-msg" className="error-text">
              <AlertOctagon className="icon" aria-hidden="true" />
              工種が選ばれていません。1つ選ぶと記録できます。
            </span>
          </div>
          <div className="field">
            <label htmlFor="sg-kind">
              種別<span className="opt">任意</span>
            </label>
            <select id="sg-kind" className="select" defaultValue="管理会社">
              <option>管理会社</option>
              <option>FC本部</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="sg-amount">
              単価(税抜)<span className="req">必須</span>
            </label>
            <input id="sg-amount" className="input input-num" defaultValue="12,000" inputMode="numeric" />
          </div>
          <div className="field">
            <label htmlFor="sg-memo">
              メモ<span className="opt">任意</span>
            </label>
            <textarea id="sg-memo" className="textarea" />
            <span className="hint">入居者のお名前は入れません(預かる情報を減らすため)。</span>
          </div>
        </div>
      </section>

      <section id="picks" className="sg-section">
        <h2>選ぶボタン(現場でスマホ1分の入力)</h2>
        <p className="lead">選ぶだけで済む形にする。押す場所は 56px 以上。選んだものは「太い枠+薄い緑の地+✓」で示す(色だけにしない)。</p>
        <div className="card card-pad sg-stack" style={{ maxWidth: 560 }}>
          <div className="picks three">
            <button type="button" className="pick center" aria-pressed="true">
              今日
            </button>
            <button type="button" className="pick center" aria-pressed="false">
              昨日
            </button>
            <button type="button" className="pick center" aria-pressed="false">
              日付を選ぶ
            </button>
          </div>
          <div className="picks">
            <button type="button" className="pick" aria-pressed="false">
              さくらマンション
              <small>集合住宅・管理会社A(架空)</small>
            </button>
            <button type="button" className="pick add">
              ＋ 新しい物件
            </button>
          </div>
        </div>
      </section>

      <section id="filters" className="sg-section">
        <h2>フィルター</h2>
        <p className="lead">表の上に置く。語句 → 選択 → 状態のチップ(複数選択)の順。件数を「10 件 / 全 48 件」の形で右に出す。絞り込みは URL に持つ。</p>
        <div className="card">
          <div className="filters">
            <div className="field search">
              <label htmlFor="sg-q">探す</label>
              <input id="sg-q" className="input" placeholder="物件名・部屋番号・案件番号・依頼の内容" />
            </div>
            <div className="field">
              <label htmlFor="sg-client">発注元</label>
              <select id="sg-client" className="select" defaultValue="">
                <option value="">すべて</option>
              </select>
            </div>
            <button type="button" className="btn btn-primary">
              絞り込む
            </button>
          </div>
          <div className="chips">
            <button type="button" className="chip" aria-pressed="true">
              すべて 13
            </button>
            <button type="button" className="chip" aria-pressed="false">
              完了 1
            </button>
            <button type="button" className="chip" aria-pressed="false">
              請求済 8
            </button>
            <span className="result-count">13 件 / 全 13 件</span>
          </div>
        </div>
      </section>

      <section id="table" className="sg-section">
        <h2>表とスマホのカード</h2>
        <p className="lead">
          PC は表。列の順は「何の行か → 誰の → いつ → 状態 → 金額 → 気づき」。金額は右揃えの等幅。スマホ幅(768px 未満)では1行を1枚のカードにする(下は画面の幅を狭めると切り替わる)。
        </p>
        <div className="card has-cards">
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th scope="col">案件</th>
                  <th scope="col">発注元</th>
                  <th scope="col">受付日</th>
                  <th scope="col">状態</th>
                  <th scope="col" className="r">
                    請求(税込)
                  </th>
                  <th scope="col">気づき</th>
                </tr>
              </thead>
              <tbody>
                <tr className="is-warn">
                  <td className="title-cell">
                    <a href="#table">さくらマンション 305</a>
                    <span className="meta">K2026-0016・原状回復</span>
                  </td>
                  <td data-label="発注元">管理会社A(架空)</td>
                  <td data-label="受付日">
                    <span className="num">2026/8/18(火)</span>
                  </td>
                  <td className="status-cell">
                    <StatusLabel tone="progress">完了</StatusLabel>
                  </td>
                  <td className="r" data-label="請求(税込)">
                    <span className="muted">—</span>
                  </td>
                  <td className="flag-cell">
                    <span className="flag flag-warn">
                      <FileWarning className="icon" aria-hidden="true" />
                      請求が未作成
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="title-cell">
                    <a href="#table">ひまわりマンション成増 502</a>
                    <span className="meta">K2026-0004・クリーニング</span>
                  </td>
                  <td data-label="発注元">管理会社B(架空)</td>
                  <td data-label="受付日">
                    <span className="num">2026/7/14(火)</span>
                  </td>
                  <td className="status-cell">
                    <StatusLabel tone="info">請求済</StatusLabel>
                  </td>
                  <td className="r" data-label="請求(税込)">
                    <span className="num">¥124,000</span>
                  </td>
                  <td className="flag-cell" />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="table-foot">並び: 要対応を上に、その中は受付日の新しい順。</div>
        </div>
      </section>

      <section id="notices" className="sg-section">
        <h2>お知らせ・空の状態</h2>
        <p className="lead">お知らせは 青(情報)・橙(注意)・赤茶(エラー)。空の状態は、何が無いかを1文で書き、次の一手のボタンを1つだけ置く。</p>
        <div className="sg-stack">
          <div className="notice notice-info" role="status">
            <Info className="icon" aria-hidden="true" />
            <div>
              <strong>見積を提出済にしました</strong>
              採用になったら、「採用にする」で案件が受注になります。
            </div>
          </div>
          <div className="notice notice-warn" role="status">
            <FileWarning className="icon" aria-hidden="true" />
            <div>
              <strong>請求が未作成です</strong>
              完了した案件に、請求がありません。
            </div>
          </div>
          <div className="notice notice-danger" role="alert">
            <AlertOctagon className="icon" aria-hidden="true" />
            <div>
              <strong>保存できませんでした</strong>
              通信を確かめて、もう一度「保存する」を押してください。
            </div>
          </div>
          <div className="toast">
            案件を登録しました。
            <a href="#notices">見積を作る</a>
          </div>
          <div className="card empty">
            <h3>条件に合う案件がありません</h3>
            <p>語句を短くするか、条件を外してみてください。</p>
            <button type="button" className="btn btn-secondary">
              条件をクリア
            </button>
          </div>
        </div>
      </section>

      <section id="flow" className="sg-section">
        <h2>案件の流れ</h2>
        <p className="lead">8つの状態を1本で見せる。済んだ段には ✓、今の段は深緑の地。失注は流れの外に、点線の枠のラベルで出す。スマホでは 4 列×2 行に折り返す。</p>
        <div className="card card-pad">
          <ol className="flow">
            <li className="done">依頼</li>
            <li className="done">見積中</li>
            <li className="done">受注</li>
            <li className="done">施工中</li>
            <li className="done">完了</li>
            <li className="now">請求済</li>
            <li>入金済</li>
          </ol>
        </div>
      </section>

      <section id="nav" className="sg-section">
        <h2>ナビ</h2>
        <p className="lead">
          PC は左の深緑のメニュー(案件・物件・台帳・発注元・設定の5項目)、スマホは下に4項目(案件・物件・台帳・その他)。現在地は aria-current で示し、PC は白い地、スマホは線と太字。実物はこの画面の左(または下)。
        </p>
      </section>
    </>
  );
}
