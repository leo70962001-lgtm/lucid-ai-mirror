#!/bin/sh
# LUCID demo —— 用 localhost 啟動，這樣相機才能用。
# 相機需要 secure context；file:// 一定會被瀏覽器擋掉。
cd "$(dirname "$0")" || exit 1
open_url() { (command -v xdg-open >/dev/null && xdg-open "$1") || (command -v open >/dev/null && open "$1") || true; }

if command -v node >/dev/null 2>&1; then
  open_url http://localhost:5173 & exec node server.js
elif command -v python3 >/dev/null 2>&1; then
  open_url http://localhost:5173 & exec python3 -m http.server 5173
else
  echo "找不到 node 或 python3。"
  echo
  echo "兩個選擇："
  echo "  1. 安裝 Node.js（https://nodejs.org）後再執行本檔"
  echo "  2. 直接打開 lucid-demo.html —— 完全離線、不需安裝任何東西，"
  echo "     但相機不能用（瀏覽器安全規則），只能用上傳照片。"
fi
