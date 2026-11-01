/**
 * Ước tính thuế hộ kinh doanh theo doanh thu cả năm — số liệu THAM KHẢO, không thay thế tư vấn thuế.
 *
 * Căn cứ (tra cứu 01/11/2026):
 *  - Bỏ thuế khoán từ 01/01/2026 (NQ 198/2025/QH15), hộ tự kê khai.
 *  - NĐ 68/2026/NĐ-CP sửa đổi bởi NĐ 141/2026/NĐ-CP: doanh thu năm ≤ 1 tỷ đồng không phải nộp thuế GTGT, TNCN.
 *  - Trên 1 tỷ: GTGT = tỷ lệ ngành × toàn bộ doanh thu; TNCN (đến 3 tỷ, cách tỷ lệ) = tỷ lệ ngành × (doanh thu − 1 tỷ),
 *    hoặc chọn cách thu nhập: (doanh thu − chi phí) × 15%. Trên 3 tỷ: TNCN = (doanh thu − chi phí) × 17% (trên 50 tỷ: 20%).
 *  - Mẫu: 01/TKN-CNKD (thông báo doanh thu, hộ ≤ 1 tỷ, hạn 31/01 năm sau), 01/CNKD (tờ khai, hộ > 1 tỷ, theo quý) — TT 18/2026/TT-BTC.
 * Khi luật đổi: sửa các hằng số ở đây và kiểm thử trong tests/reports-tax.test.ts.
 */
export type TaxIndustry = 'GOODS' | 'PRODUCTION' | 'SERVICE' | 'LEASING' | 'OTHER';

export const TAX_FREE_THRESHOLD = 1_000_000_000;
const RATE_METHOD_LIMIT = 3_000_000_000;
const HIGH_LIMIT = 50_000_000_000;

/** Tỷ lệ % trên doanh thu theo ngành (GTGT, TNCN), đơn vị phần nghìn để tránh số lẻ: 10 = 1%. */
export const INDUSTRY_RATES: Record<TaxIndustry, { vat: number; pit: number }> = {
  GOODS: { vat: 10, pit: 5 }, //        Phân phối, cung cấp hàng hóa: 1% / 0,5%
  PRODUCTION: { vat: 30, pit: 15 }, //  Sản xuất, vận tải, dịch vụ có gắn với hàng hóa (ăn uống): 3% / 1,5%
  SERVICE: { vat: 50, pit: 20 }, //     Dịch vụ không bao thầu nguyên vật liệu: 5% / 2%
  LEASING: { vat: 50, pit: 50 }, //     Cho thuê tài sản: 5% / 5%
  OTHER: { vat: 20, pit: 10 }, //       Hoạt động khác: 2% / 1%
};

const perMille = (amount: number, rate: number) => Math.round((amount * rate) / 1000);

export interface TaxEstimate {
  revenue: number;
  /** Doanh thu cả năm nếu cứ bán đều như từ đầu năm đến nay */
  projectedRevenue: number;
  overThreshold: boolean;
  projectedOverThreshold: boolean;
  vat: number;
  /** TNCN theo cách tỷ lệ trên doanh thu (chỉ áp dụng khi doanh thu ≤ 3 tỷ) */
  pitByRate: number | null;
  /** TNCN theo thu nhập (doanh thu − chi phí đã ghi) */
  pitByIncome: number;
  /** Cách được dùng để cộng tổng: tỷ lệ (≤ 3 tỷ) hoặc thu nhập (> 3 tỷ) */
  method: 'NONE' | 'RATE' | 'INCOME';
  total: number;
  form: '01/TKN-CNKD' | '01/CNKD';
}

/** Ngày thứ mấy trong năm theo lịch VN (1..366) và số ngày của năm. */
export function dayOfYear(day: string): { n: number; days: number } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const start = Date.UTC(y, 0, 1);
  const n = Math.round((Date.UTC(y, m - 1, d) - start) / 86_400_000) + 1;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return { n, days: leap ? 366 : 365 };
}

export function estimateTax(input: { revenue: number; expenses: number; industry: TaxIndustry; today: string }): TaxEstimate {
  const { revenue, expenses, industry, today } = input;
  const rate = INDUSTRY_RATES[industry];
  const { n, days } = dayOfYear(today);
  const projectedRevenue = n >= days ? revenue : Math.round((revenue / n) * days);
  const over = revenue > TAX_FREE_THRESHOLD;
  const income = Math.max(revenue - expenses, 0);
  const incomeRate = revenue > HIGH_LIMIT ? 200 : revenue > RATE_METHOD_LIMIT ? 170 : 150;
  const pitByIncome = over ? perMille(income, incomeRate) : 0;

  if (!over) {
    return {
      revenue, projectedRevenue, overThreshold: false, projectedOverThreshold: projectedRevenue > TAX_FREE_THRESHOLD,
      vat: 0, pitByRate: 0, pitByIncome: 0, method: 'NONE', total: 0, form: '01/TKN-CNKD',
    };
  }
  const vat = perMille(revenue, rate.vat);
  const pitByRate = revenue <= RATE_METHOD_LIMIT ? perMille(revenue - TAX_FREE_THRESHOLD, rate.pit) : null;
  const method = pitByRate === null ? 'INCOME' : 'RATE';
  const pit = pitByRate ?? pitByIncome;
  return {
    revenue, projectedRevenue, overThreshold: true, projectedOverThreshold: true,
    vat, pitByRate, pitByIncome, method, total: vat + pit, form: '01/CNKD',
  };
}

/** Hạn nộp gần nhất kể từ hôm nay: hộ ≤ 1 tỷ thông báo doanh thu năm trước trước 31/01; hộ > 1 tỷ khai theo quý. */
export function nextDeadline(today: string, over: boolean): { date: string; label: 'YEAR_NOTICE' | 'QUARTER_RETURN'; period: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  if (!over) {
    // Đang trong tháng 1: hạn của năm trước; còn lại: hạn 31/01 năm sau cho năm nay
    return m === 1
      ? { date: `${y}-01-31`, label: 'YEAR_NOTICE', period: String(y - 1) }
      : { date: `${y + 1}-01-31`, label: 'YEAR_NOTICE', period: String(y) };
  }
  // Quý đang khai = quý trước; hạn = ngày cuối tháng đầu của quý hiện tại. Nếu đã qua hạn thì sang quý hiện tại.
  const q = Math.floor((m - 1) / 3) + 1;
  const firstMonth = (q - 1) * 3 + 1;
  const lastDayOf = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pad = (v: number) => (v < 10 ? `0${v}` : String(v));
  if (m === firstMonth) {
    const prevQ = q === 1 ? 4 : q - 1;
    const prevY = q === 1 ? y - 1 : y;
    return { date: `${y}-${pad(firstMonth)}-${lastDayOf(y, firstMonth)}`, label: 'QUARTER_RETURN', period: `Q${prevQ}/${prevY}` };
  }
  const nextFirst = firstMonth + 3;
  const ny = nextFirst > 12 ? y + 1 : y;
  const nm = nextFirst > 12 ? 1 : nextFirst;
  return { date: `${ny}-${pad(nm)}-${lastDayOf(ny, nm)}`, label: 'QUARTER_RETURN', period: `Q${q}/${y}` };
}
