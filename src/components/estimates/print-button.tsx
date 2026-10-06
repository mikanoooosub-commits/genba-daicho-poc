"use client";

import { Printer } from "lucide-react";

// ブラウザの印刷を開く。PDF にするときは、印刷の画面で「PDF に保存」を選ぶ。
export function PrintButton() {
  return (
    <button className="btn btn-primary" type="button" onClick={() => window.print()}>
      <Printer className="icon" aria-hidden="true" />
      印刷する
    </button>
  );
}
