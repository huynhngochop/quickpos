#!/usr/bin/env bash
# Chạy toàn bộ luồng Maestro theo thứ tự, ROUNDS vòng (mỗi vòng bắt đầu bằng cài đặt lại từ đầu).
# Kết quả, log, ảnh chụp nằm trong qa-out/. Lỗi đầu tiên của mỗi vòng được đưa thành annotation.
# Dùng: ROUNDS=2 bash scripts/qa-run.sh <tên-thiết-bị>
set -u
LABEL="${1:-device}"
ROUNDS="${ROUNDS:-2}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/qa-out"
mkdir -p "$OUT"
cd "$OUT"
export PATH="$PATH:$HOME/.maestro/bin"
FLOWS=(01-onboarding 02-thu-tien-qr 03-xac-nhan-tay-va-huy 04-tien-mat 05-so-va-xem-lai 07-du-lieu-lon 08-so-no-chi-tieu-bao-cao-thue 09-hang-hoa-ban-mon-khach-ca-hoa-don 06-cai-dat)
summary="$OUT/SUMMARY.md"
echo "# QA $LABEL — $(date -u +%FT%TZ)" > "$summary"
total_fail=0

for round in $(seq 1 "$ROUNDS"); do
  echo "## Vòng $round" >> "$summary"
  for f in "${FLOWS[@]}"; do
    dir="r${round}-${f}"
    mkdir -p "$dir"
    start=$(date +%s)
    ( cd "$dir" && maestro test "$ROOT/.maestro/${f}.yaml" --format junit --output report.xml --test-output-dir . ) > "$dir/maestro.log" 2>&1
    code=$?
    # Lỗi hạ tầng (trình điều khiển máy ảo khởi động chậm), không phải lỗi app: chạy lại luồng một lần
    if [ "$code" -ne 0 ] && grep -q "driver not ready in time" "$dir/maestro.log"; then
      echo "- ↻ $f: trình điều khiển máy ảo chưa sẵn sàng, chạy lại" >> "$summary"
      ( cd "$dir" && maestro test "$ROOT/.maestro/${f}.yaml" --format junit --output report.xml --test-output-dir . ) > "$dir/maestro.log" 2>&1
      code=$?
    fi
    secs=$(( $(date +%s) - start ))
    if [ "$code" -eq 0 ]; then
      echo "- ✅ $f (${secs}s)" >> "$summary"
    else
      total_fail=$((total_fail + 1))
      echo "- ❌ $f (${secs}s) — xem $dir/maestro.log" >> "$summary"
      msg=$(tail -n 40 "$dir/maestro.log" | sed -e 's/%/%25/g' | awk 'BEGIN{ORS="%0A"} {print}')
      echo "::error title=$LABEL vòng $round: $f lỗi::$msg"
      # Chụp màn hình lúc lỗi + cây giao diện để biết đang ở đâu
      (cd "$dir" && maestro hierarchy > hierarchy.json 2>/dev/null) || true
      break
    fi
  done
done

# Gom mọi ảnh chụp về một chỗ cho dễ xem
mkdir -p "$OUT/shots"
find "$OUT" -name '*.png' -not -path "$OUT/shots/*" | while read -r p; do
  rel="${p#$OUT/}"; cp "$p" "$OUT/shots/$(echo "$rel" | tr '/' '_')"
done
echo "" >> "$summary"
echo "Ảnh: $(ls "$OUT/shots" | wc -l)" >> "$summary"
cat "$summary"
exit "$total_fail"
