// Nhà cung cấp hóa đơn điện tử. Mỗi nhà cung cấp một adapter; app không biết chi tiết, chỉ gọi Edge Function issue-einvoice.
// CLAUDE.md: KHÔNG bịa endpoint/trường dữ liệu của nhà cung cấp. MISA/Viettel/VNPT để TODO cho tới khi có tài liệu
// sandbox + tài khoản kết nối của hộ (lưu trong secrets, không trong DB/app).

export type EinvoiceProvider = 'NONE' | 'DEMO' | 'MISA' | 'VIETTEL' | 'VNPT' | 'OTHER';

export interface IssuedResult {
  invoiceNo: number;
  taxAuthorityCode: string;
  providerRef: string;
  lookupUrl: string | null;
}

/** Mã của cơ quan thuế dạng hóa đơn máy tính tiền, bản dùng thử (có chữ DEMO để không nhầm với mã thật). */
export function demoTaxAuthorityCode(year: number, invoiceNo: number): string {
  const yy = String(year % 100).padStart(2, '0');
  return `M1-${yy}-DEMO0-${String(invoiceNo).padStart(11, '0')}`;
}

export function providerReady(p: EinvoiceProvider): boolean {
  return p === 'DEMO';
}
