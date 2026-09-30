import { FlaskConical } from "lucide-react";

/**
 * デモ表示中であることを常時知らせるバナー。
 * 「デモを見ているのか本番を見ているのか分からない」状態が一番危ないので、デモ中は必ず画面に出す。
 *
 * あえてワンタップの解除ボタンは置いていない。
 * 理由: デモは人に見せている最中の画面なので、その場に「押すと本番データが出るボタン」が
 * あると、誤タップや相手の操作で実データが露見しうる。
 * 解除はログアウト → ログイン画面のチェックを外す、という意図的な手順を踏ませる。
 */
export function DemoBanner() {
  return (
    <div className="flex items-center gap-2 bg-amber-500 px-4 py-2 text-white">
      <FlaskConical className="size-4 shrink-0" />
      <span className="text-sm font-bold">デモデータを表示中</span>
    </div>
  );
}
