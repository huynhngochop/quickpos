#!/usr/bin/env bash
# QA hai máy, giữa luồng 12a và 12b: máy nhân viên giả (Node, đúng mã giao thức của app) nối vào máy chủ quán
# chạy trên máy ảo qua adb forward. Đọc mã ghép máy dạng chữ từ cây giao diện (maestro hierarchy).
# Kiểm tra thêm: dịch vụ chạy nền của máy chủ quán (modules/qp-foreground) đang chạy.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$PATH:$HOME/.maestro/bin"
adb forward tcp:47123 tcp:47123
maestro hierarchy > hierarchy-pair.json 2>/dev/null || true
CODE="$(grep -o 'QPLAN1:[A-Za-z0-9_-]*' hierarchy-pair.json | head -n 1 || true)"
if [ -z "$CODE" ]; then
  echo "Không đọc được mã ghép máy trên màn hình"
  exit 1
fi
echo "Mã ghép máy: ${CODE:0:20}…"
(cd "$ROOT" && npx tsx scripts/qa-lan-client.ts "$CODE" "$PWD/lan-client.json")
# Dịch vụ chạy nền: phải đang chạy ở chế độ foreground khi máy này làm máy chủ quán
adb shell dumpsys activity services vn.quickpos.app > services.txt 2>&1 || true
if grep -q "QpForegroundService" services.txt && grep -q "isForeground=true" services.txt; then
  echo "✅ dịch vụ chạy nền của máy chủ quán đang chạy"
else
  echo "❌ không thấy dịch vụ chạy nền QpForegroundService"
  sed -n '1,60p' services.txt
  exit 1
fi
adb shell dumpsys notification --noredact 2>/dev/null | grep -A3 "quickpos-lan-host" | head -n 8 || true
