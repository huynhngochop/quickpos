#!/usr/bin/env bash
# Cài thư viện cho QuickPOS. Thư viện của Expo cài qua `expo install` để lấy đúng phiên bản khớp SDK 57.
# Chạy một lần sau khi clone: npm run setup
set -euo pipefail
cd "$(dirname "$0")/.."

npm install expo@~57.0.0

npx expo install \
  react react-native react-dom react-native-web \
  expo-router expo-linking expo-constants expo-status-bar expo-font expo-splash-screen \
  react-native-safe-area-context react-native-screens \
  @react-native-async-storage/async-storage @react-native-community/netinfo \
  expo-sqlite expo-secure-store expo-crypto expo-speech expo-haptics \
  expo-notifications expo-device expo-application expo-intent-launcher expo-screen-orientation \
  react-native-svg @expo-google-fonts/be-vietnam-pro \
  expo-print expo-sharing expo-camera

npm install \
  @supabase/supabase-js@^2 \
  @tanstack/react-query@^5 \
  zustand@^5 \
  react-hook-form@^7 @hookform/resolvers@^5 zod@^4 \
  react-native-qrcode-svg@^6

npm install -D typescript @types/react tsx

npx expo install --fix
npx expo-doctor@latest || true

echo
echo "Xong. Tạo file .env từ .env.example rồi chạy: npx expo run:android"
echo "(Báo tiền bằng thông báo đẩy cần bản build thật — Expo Go không đủ.)"
