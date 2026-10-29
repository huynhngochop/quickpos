/**
 * Tên ngân hàng (như cổng thanh toán gửi trong webhook, ví dụ SePay `gateway`) → mã BIN NAPAS 6 số.
 * `confirm_payment()` khớp hộ theo (bank_bin, account_no), nên tên phải đổi ra BIN giống lúc ghi
 * `payment_accounts`. Gặp tên chưa có trong bảng: webhook vẫn lưu giao dịch (UNKNOWN_ACCOUNT) để kiểm tra.
 * TODO: đối chiếu danh sách `gateway` thật với tài liệu/sandbox của cổng trước khi chạy thật.
 */
const BIN_BY_KEY: Record<string, string> = {
  vietcombank: '970436', vcb: '970436',
  vietinbank: '970415', ctg: '970415', icb: '970415',
  bidv: '970418',
  agribank: '970405', vba: '970405',
  mbbank: '970422', mb: '970422',
  techcombank: '970407', tcb: '970407',
  acb: '970416',
  vpbank: '970432',
  tpbank: '970423',
  sacombank: '970403', stb: '970403',
  hdbank: '970437',
  vib: '970441',
  shb: '970443',
  seabank: '970440',
  ocb: '970448',
  msb: '970426',
  eximbank: '970431',
  lpbank: '970449', lienvietpostbank: '970449',
  kienlongbank: '970452',
  namabank: '970428',
  bacabank: '970409',
  abbank: '970425',
  pvcombank: '970412',
  vietabank: '970427',
  bvbank: '970454', vietcapitalbank: '970454',
  ncb: '970419',
  saigonbank: '970400',
  pgbank: '970430',
  vietbank: '970433',
  baovietbank: '970438',
  gpbank: '970408',
};

export function bankKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function bankBinFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (/^[0-9]{6}$/.test(name.trim())) return name.trim();
  return BIN_BY_KEY[bankKey(name)] ?? null;
}

const NAME_BY_BIN: Record<string, string> = {
  '970436': 'Vietcombank', '970415': 'VietinBank', '970418': 'BIDV', '970405': 'Agribank',
  '970422': 'MB Bank', '970407': 'Techcombank', '970416': 'ACB', '970432': 'VPBank',
  '970423': 'TPBank', '970403': 'Sacombank', '970437': 'HDBank', '970441': 'VIB',
  '970443': 'SHB', '970440': 'SeABank', '970448': 'OCB', '970426': 'MSB',
  '970431': 'Eximbank', '970449': 'LPBank', '970452': 'KienlongBank', '970428': 'Nam A Bank',
  '970409': 'Bac A Bank', '970425': 'ABBANK', '970412': 'PVcomBank', '970427': 'VietABank',
  '970454': 'BVBank', '970419': 'NCB', '970400': 'Saigonbank', '970430': 'PGBank',
  '970433': 'Vietbank', '970438': 'BaoViet Bank', '970408': 'GPBank',
};

export function bankDisplayName(bin: string): string {
  return NAME_BY_BIN[bin] ?? 'Ngân hàng';
}
