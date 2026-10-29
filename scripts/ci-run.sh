#!/usr/bin/env bash
# Chạy một lệnh trong CI; nếu lỗi, đưa phần quan trọng của log thành annotation (đọc được qua API mà không cần tải log).
# Dùng: bash scripts/ci-run.sh <tên bước> <lệnh...>
set -o pipefail
name="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
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
