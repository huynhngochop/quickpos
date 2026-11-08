#!/usr/bin/env bash
# Cài Maestro cho QA; máy chủ tải hay lỗi mạng tạm thời → thử lại tối đa 6 lần, chờ giãn dần. Không cài được thì dừng hẳn.
set -u
for attempt in 1 2 3 4 5 6; do
  if curl -fsSL --retry 3 --retry-delay 10 "https://get.maestro.mobile.dev" -o /tmp/install-maestro.sh && bash /tmp/install-maestro.sh \
    && [ -x "$HOME/.maestro/bin/maestro" ]; then
    "$HOME/.maestro/bin/maestro" --version || true
    exit 0
  fi
  echo "::warning title=maestro::Cài Maestro lỗi (lần $attempt), thử lại sau $((attempt * 60)) giây"
  sleep $((attempt * 60))
done
echo "::error title=maestro::Không cài được Maestro (máy chủ tải lỗi)"
exit 1
