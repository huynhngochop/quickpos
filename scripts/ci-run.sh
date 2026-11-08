#!/usr/bin/env bash
# Chạy một lệnh trong CI; nếu lỗi, đưa phần quan trọng của log thành annotation (đọc được qua API mà không cần tải log).
# Lỗi mạng tạm thời (máy chủ tải Gradle / Maven trả 502/503/504, hết giờ chờ) thì tự chạy lại tối đa 6 lần, chờ giãn dần (60, 120, … giây).
# Dùng: bash scripts/ci-run.sh <tên bước> <lệnh...>
set -o pipefail
name="$1"; shift
log="$(mktemp)"
attempt=1
while :; do
  "$@" 2>&1 | tee "$log"
  code=${PIPESTATUS[0]}
  [ "$code" -eq 0 ] && break
  if [ "$attempt" -lt 6 ] && grep -qiE "response code: 50[234]|status code 50[234]|Gateway Time-?out|Read timed out|Connection reset|timeout \([0-9]+ms\)|Could not GET|ETIMEDOUT|ECONNRESET|EAI_AGAIN" "$log"; then
    wait_s=$((attempt * 60))
    echo "::warning title=${name}::Lỗi mạng tạm thời, chạy lại lần $((attempt + 1)) sau ${wait_s} giây"
    attempt=$((attempt + 1))
    sleep "$wait_s"
    continue
  fi
  break
done
if [ "$code" -ne 0 ]; then
  {
    # Gradle: phần "What went wrong" và các dòng "Caused by" là đủ để biết nguyên nhân
    grep -n -A 25 "What went wrong" "$log" | head -n 60
    grep -n "Caused by\|error:\|Error:\|ERR!\|FAILURE" "$log" | head -n 40
    echo "----- 30 dòng cuối -----"
    tail -n 30 "$log"
  } | cut -c1-300 | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}' > "$log.tail"
  echo "::error title=${name} failed (exit ${code})::$(cat "$log.tail")"
fi
exit "$code"
