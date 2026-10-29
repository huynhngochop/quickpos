#!/usr/bin/env bash
# Mở một iPhone Simulator có sẵn, cài bản Release, chạy toàn bộ luồng 2 vòng.
set -u
cd "$(dirname "$0")/.."
mkdir -p qa-out
UDID=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
d = json.load(sys.stdin)["devices"]
phones = [x for rt, xs in d.items() if "iOS" in rt for x in xs if x["name"].startswith("iPhone")]
phones.sort(key=lambda x: x["name"])
print(phones[-1]["udid"])')
xcrun simctl list devices | grep "$UDID" > qa-out/device.txt
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
APP=$(find build/Build/Products/Release-iphonesimulator -maxdepth 1 -name '*.app' | head -n 1)
xcrun simctl install "$UDID" "$APP"
xcrun simctl spawn "$UDID" log stream --level error --predicate 'process == "QuickPOS"' > qa-out/ios-log.txt 2>&1 &
LOG=$!
ROUNDS=2 bash scripts/qa-run.sh ios
code=$?
kill "$LOG" 2>/dev/null || true
tail -n 300 qa-out/ios-log.txt > qa-out/ios-log-tail.txt || true
exit "$code"
