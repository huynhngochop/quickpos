#!/usr/bin/env bash
# Tự tạo và mở Android emulator (thay cho action có sẵn) để ghi được log từng bước vào qa-out/.
# Dùng: bash scripts/android-emulator.sh <nhãn> <profile thiết bị>   ví dụ: android-phone pixel_6
set -u
LABEL="$1"; PROFILE="$2"
cd "$(dirname "$0")/.."
mkdir -p qa-out
LOG=qa-out/emulator-setup.log
exec > >(tee -a "$LOG") 2>&1
SDK="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
# Cố định thư mục AVD cho cả avdmanager và emulator (bản cmdline-tools cũ ghi sang chỗ khác)
export ANDROID_AVD_HOME="$HOME/.android/avd"
export ANDROID_SDK_ROOT="$SDK"
mkdir -p "$ANDROID_AVD_HOME"
BIN="$SDK/cmdline-tools/latest/bin"
IMAGE="system-images;android-34;google_apis;x86_64"
export PATH="$SDK/platform-tools:$SDK/emulator:$PATH"

step() { echo "::group::$1"; echo ">>> $1"; }
fail() { echo "::error title=emulator $LABEL::$1 (xem qa-out/emulator-setup.log, qa-out/emulator.log)"; exit 1; }

step "KVM"
ls -l /dev/kvm || fail "không có /dev/kvm"
echo "::endgroup::"

step "Cài system image"
yes | "$BIN/sdkmanager" --install "$IMAGE" "emulator" "platform-tools" > qa-out/sdkmanager.log 2>&1 || fail "sdkmanager lỗi"
tail -n 5 qa-out/sdkmanager.log
echo "::endgroup::"

step "Tạo AVD ($PROFILE)"
echo no | "$BIN/avdmanager" create avd -n qa -k "$IMAGE" -d "$PROFILE" --force || fail "avdmanager lỗi"
# RAM/ổ đủ cho máy tính bảng
printf 'hw.ramSize=4096\ndisk.dataPartition.size=6G\nhw.keyboard=yes\n' >> "$ANDROID_AVD_HOME/qa.avd/config.ini"
"$BIN/avdmanager" list avd
ls -la "$ANDROID_AVD_HOME"
echo "::endgroup::"

step "Mở emulator"
emulator -avd qa -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim -no-snapshot -camera-back none -camera-front none \
  > qa-out/emulator.log 2>&1 &
EMU=$!
adb start-server
for i in $(seq 1 120); do
  if ! kill -0 "$EMU" 2>/dev/null; then tail -n 40 qa-out/emulator.log; fail "emulator thoát sớm"; fi
  boot=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  [ "$boot" = "1" ] && break
  sleep 5
done
[ "$boot" = "1" ] || { tail -n 40 qa-out/emulator.log; fail "emulator không khởi động xong sau 10 phút"; }
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb shell input keyevent 82
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put secure anr_show_background 0 || true
sleep 30
adb shell input keyevent 3
echo "::endgroup::"

step "Chạy kiểm thử"
bash scripts/qa-android.sh "$LABEL"
code=$?
echo "::endgroup::"
adb emu kill 2>/dev/null || true
exit "$code"
