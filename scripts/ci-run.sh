#!/usr/bin/env bash
# Chạy một lệnh trong CI; nếu lỗi, đưa 80 dòng cuối thành annotation (đọc được qua API mà không cần tải log).
# Dùng: bash scripts/ci-run.sh <tên bước> <lệnh...>
set -o pipefail
name="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
if [ "$code" -ne 0 ]; then
  tail -n 80 "$log" | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}' > "$log.tail"
  echo "::error title=${name} failed (exit ${code})::$(cat "$log.tail")"
fi
exit "$code"
