#!/usr/bin/env bash
# Đẩy thư mục qa-out lên nhánh riêng (ghi đè) để đọc kết quả qua git: qa-<nhãn>
set -eu
LABEL="$1"
cd "$(dirname "$0")/../qa-out"
rm -rf .git
git init -q
git checkout -q -b "qa-$LABEL"
git add -A
git -c user.name="QuickPOS QA" -c user.email="qa@quickpos.invalid" commit -qm "QA $LABEL run $GITHUB_RUN_ID"
git push -qf "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "qa-$LABEL"
