#!/usr/bin/env bash
# Đẩy thư mục qa-out lên nhánh riêng (ghi đè) để đọc kết quả qua git: qa-<nhãn>
set -eu
LABEL="$1"
mkdir -p "$(dirname "$0")/../qa-out"
cd "$(dirname "$0")/../qa-out"
rm -rf .git
# Bỏ file quá lớn (GitHub chặn > 100 MB): chỉ giữ 2 MB cuối
find . -type f -size +20M | while read -r f; do tail -c 2000000 "$f" > "$f.tail" && rm "$f"; done
git init -q
git checkout -q -b "qa-$LABEL"
git add -A
git -c user.name="QuickPOS QA" -c user.email="qa@quickpos.invalid" commit -qm "QA $LABEL run $GITHUB_RUN_ID"
git push -qf "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "qa-$LABEL"
