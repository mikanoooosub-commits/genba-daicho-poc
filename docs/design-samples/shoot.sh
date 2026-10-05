#!/usr/bin/env bash
# 見本のスクリーンショットを撮る(確認用)。design-samples の静的サーバー(127.0.0.1:4173)が動いている前提。
# 使い方: bash shoot.sh <ページ.html> <PCの高さ> <スマホの高さ>
# スマホ幅は _phone.html の 375px の iframe で撮る(ヘッドレスの Chrome は窓を 375px まで狭められないため)。
set -e
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
P="${TEMP}/chprof-$RANDOM$RANDOM"   # 毎回新しいプロファイル(CSS のキャッシュを避ける)
OUT="$(cygpath -m "$PWD/screenshots")"
name="${1%.html}"
"$CH" --headless=new --disable-gpu --user-data-dir="$P" --hide-scrollbars --window-size=1280,"$2" \
  --screenshot="$OUT/$name-pc.png" "http://127.0.0.1:4173/$1" 2>&1 | grep "written" || true
"$CH" --headless=new --disable-gpu --user-data-dir="$P" --hide-scrollbars --window-size=375,"$3" \
  --screenshot="$OUT/$name-sp.png" "http://127.0.0.1:4173/_phone.html?p=$1&h=$3" 2>&1 | grep "written" || true
