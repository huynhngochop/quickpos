/**
 * Nhật ký chẩn đoán cho bản kiểm thử (EXPO_PUBLIC_QA_LOG=1, đặt trong .github/workflows/qa.yml): ghi ra logcat thẻ
 * ReactNativeJS với tiền tố "[QP]". Bản phát hành không ghi gì.
 */
export const QA_LOG = process.env.EXPO_PUBLIC_QA_LOG === '1';

export function qaLog(...parts: unknown[]) {
  if (!QA_LOG) return;
  console.warn('[QP]', ...parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))));
}

let beat: ReturnType<typeof setInterval> | null = null;
/** Nhịp 2 giây: thấy nhịp ngừng trong logcat = luồng JS bị treo */
export function startQaHeartbeat() {
  if (!QA_LOG || beat) return;
  let n = 0;
  beat = setInterval(() => qaLog('nhịp', n++), 2000);
}
