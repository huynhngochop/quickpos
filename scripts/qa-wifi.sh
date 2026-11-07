#!/usr/bin/env bash
# QA hai máy: bật Wi‑Fi của máy ảo và chờ có IP (mã ghép máy cần IP Wi‑Fi của máy chủ quán).
set -u
adb shell svc wifi enable || true
for i in $(seq 1 30); do
  ip="$(adb shell ip -4 addr show wlan0 2>/dev/null | grep -o 'inet [0-9.]*' | head -n 1)"
  if [ -n "$ip" ]; then echo "Wi‑Fi máy ảo: $ip"; exit 0; fi
  sleep 2
done
echo "Máy ảo chưa có Wi‑Fi (wlan0)"
adb shell ip addr || true
exit 1
