/**
 * Sinh chuỗi VietQR (chuẩn EMVCo QR của NAPAS) để app vẽ mã QR — không phụ thuộc domain bên thứ ba.
 * Cấu trúc: ID(2) + độ dài(2) + giá trị. CRC16-CCITT (poly 0x1021, init 0xFFFF) ở trường 63.
 * Dùng chung cho Edge Function và test (Node/Deno, không import gì).
 */

function tlv(id: string, value: string): string {
  if (value.length > 99) throw new RangeError(`Trường ${id} dài quá 99 ký tự`);
  return id + String(value.length).padStart(2, '0') + value;
}

export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Bỏ dấu tiếng Việt và ký tự lạ: nội dung chuyển khoản chỉ nên có chữ, số, khoảng trắng. */
export function toTransferContent(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
}

export interface VietQrInput {
  bankBin: string;      // 6 số NAPAS, ví dụ "970422"
  accountNo: string;    // số tài khoản hoặc tài khoản ảo
  amount?: number;      // VND, số nguyên > 0; bỏ trống = QR tĩnh
  content?: string;     // nội dung chuyển khoản (thường là mã đơn)
}

export function buildVietQr({ bankBin, accountNo, amount, content }: VietQrInput): string {
  if (!/^[0-9]{6}$/.test(bankBin)) throw new RangeError('Mã ngân hàng phải gồm 6 số');
  if (!/^[0-9A-Za-z]{1,19}$/.test(accountNo)) throw new RangeError('Số tài khoản không hợp lệ');
  if (amount !== undefined && (!Number.isSafeInteger(amount) || amount <= 0 || amount > 99_999_999_999)) {
    throw new RangeError('Số tiền không hợp lệ');
  }
  const beneficiary = tlv('00', bankBin) + tlv('01', accountNo);
  const merchant = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');
  const safeContent = content ? toTransferContent(content) : '';
  let payload =
    tlv('00', '01') +
    tlv('01', amount ? '12' : '11') +   // 12 = mã dùng một lần (có số tiền), 11 = mã tĩnh
    tlv('38', merchant) +
    tlv('53', '704') +                  // VND
    (amount ? tlv('54', String(amount)) : '') +
    tlv('58', 'VN') +
    (safeContent ? tlv('62', tlv('08', safeContent)) : '');
  payload += '6304';
  return payload + crc16ccitt(payload);
}
