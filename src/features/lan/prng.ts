/**
 * tweetnacl cần nguồn số ngẫu nhiên an toàn. React Native không có crypto.getRandomValues như trình duyệt/Node
 * ("Error: no PRNG"), nên lấy từ expo-crypto (dùng bộ sinh số ngẫu nhiên của hệ điều hành). Nạp một lần lúc mở app.
 */
import nacl from 'tweetnacl';
import { getRandomBytes } from 'expo-crypto';

nacl.setPRNG((out: Uint8Array, n: number) => {
  const r = getRandomBytes(n);
  for (let i = 0; i < n; i++) out[i] = r[i]!;
});
