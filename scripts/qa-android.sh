#!/usr/bin/env bash
# Chạy trong android-emulator-runner: cài APK, ghi thông tin máy, chạy toàn bộ luồng 2 vòng.
set -u
LABEL="${1:-android}"
cd "$(dirname "$0")/.."
mkdir -p qa-out
adb wait-for-device
adb install -r android/app/build/outputs/apk/release/app-release.apk
{
  echo "model: $(adb shell getprop ro.product.model)"
  echo "android: $(adb shell getprop ro.build.version.release)"
  adb shell wm size
  adb shell wm density
} > qa-out/device.txt 2>&1
# Ghi logcat để bắt lỗi JS/văng app
adb logcat -c
adb logcat '*:E' ReactNativeJS:V > qa-out/logcat.txt 2>&1 &
LOGCAT=$!
ROUNDS=2 bash scripts/qa-run.sh "$LABEL"
code=$?
kill "$LOGCAT" 2>/dev/null || true
grep -E "FATAL|ReactNativeJS|AndroidRuntime" qa-out/logcat.txt | tail -n 200 > qa-out/logcat-errors.txt || true
exit "$code"
