/**
 * Mẫu số 01/TKN-CNKD — Thông báo doanh thu / Tờ khai thuế năm (Phụ lục I, Thông tư 89/2026/TT-BTC ngày 30/06/2026).
 * App chỉ dùng cho hộ, cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống: theo ghi chú của mẫu, nhóm này chỉ
 * thông báo doanh thu, không khai số thuế GTGT, TNCN phải nộp → điền phần đầu và cột doanh thu của mục A,
 * các phần khác để trống ("không phát sinh"). Số liệu THAM KHẢO, người nộp thuế kiểm tra lại trước khi ký nộp.
 *
 * Bố cục ở đây theo mô tả công khai của mẫu (chưa đối chiếu được file gốc của Bộ Tài chính): khi có file gốc,
 * sửa COLUMNS / ROWS bên dưới cho khớp, phần tính số không đổi.
 */
import type { TaxGroup } from '../../types/api';
import { buildXlsx, colName, type Cell, type Sheet } from '../../lib/xlsx';

export type Form01Period = 'YEAR' | 'H1' | 'H2';

export interface Form01Data {
  period: Form01Period;
  year: number;
  first: boolean;
  supplementNo: number | null;
  taxpayer: string;
  taxCode: string;
  address: string;
  phone: string;
  byGroup: Partial<Record<TaxGroup, number>>;
  total: number;
  /** Ngày ký 'YYYY-MM-DD' */
  signDay: string;
}

/** Mã nhóm ngành nghề theo ghi chú của mẫu (1–6) */
export const GROUP_CODE: Record<TaxGroup, number> = { GOODS: 1, SERVICE: 2, LEASING: 3, PRODUCTION: 4, DIGITAL: 5, OTHER: 6 };
export const GROUP_NAME: Record<TaxGroup, string> = {
  GOODS: 'Phân phối, cung cấp hàng hóa',
  SERVICE: 'Dịch vụ, xây dựng không bao thầu nguyên vật liệu',
  LEASING: 'Hoạt động cho thuê tài sản trừ bất động sản',
  PRODUCTION: 'Sản xuất, vận tải, dịch vụ có gắn với hàng hóa, xây dựng có bao thầu nguyên vật liệu',
  DIGITAL: 'Hoạt động cung cấp sản phẩm nội dung thông tin số',
  OTHER: 'Hoạt động kinh doanh khác',
};

export const FORM01_LIMIT = 1_000_000_000;

/** Ngày đầu / cuối của kỳ */
export function form01Range(period: Form01Period, year: number): { from: string; to: string } {
  if (period === 'H1') return { from: `${year}-01-01`, to: `${year}-06-30` };
  if (period === 'H2') return { from: `${year}-07-01`, to: `${year}-12-31` };
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Các cột của bảng mục A: (1)…(11). Chỉ cột "Tổng doanh thu" được điền. */
const COLUMNS = [
  '(1) STT',
  '(2) Chỉ tiêu',
  '(3) Mã chỉ tiêu',
  '(4) Nhóm ngành nghề',
  '(5) Thuế GTGT — Tổng doanh thu',
  '(6) Trong đó: doanh thu không chịu thuế GTGT',
  '(7) Trong đó: doanh thu chịu thuế suất 0%',
  '(8) Thuế GTGT — Số thuế phải nộp',
  '(9) Thuế TNCN — Doanh thu chịu thuế',
  '(10) Doanh thu được trừ để xác định doanh thu tính thuế',
  '(11) Thuế TNCN — Số thuế phải nộp',
];
const REVENUE_COL = 4;

export interface Form01Row {
  stt: string;
  label: string;
  code: string;
  group: string;
  revenue: number | null;
  bold?: boolean;
}

/** Các dòng mục A (phần I: hoạt động kinh doanh; phần II: cho thuê bất động sản) */
export function form01Rows(d: Form01Data): Form01Row[] {
  const groups = (Object.keys(GROUP_CODE) as TaxGroup[]).filter((g) => (d.byGroup[g] ?? 0) > 0);
  const fixed: Form01Row[] = groups.length
    ? groups.map((g, i) => ({
        stt: i === 0 ? '1' : '',
        label: i === 0 ? 'Hoạt động kinh doanh tại cửa hàng, địa điểm cố định' : '',
        code: i === 0 ? '[08]' : '',
        group: `${GROUP_CODE[g]}. ${GROUP_NAME[g]}`,
        revenue: d.byGroup[g] ?? 0,
      }))
    : [{ stt: '1', label: 'Hoạt động kinh doanh tại cửa hàng, địa điểm cố định', code: '[08]', group: '', revenue: 0 }];
  return [
    { stt: 'I', label: 'Hoạt động kinh doanh (trừ cho thuê bất động sản)', code: '', group: '', revenue: null, bold: true },
    ...fixed,
    { stt: '2', label: 'Kinh doanh trên nền tảng thương mại điện tử, nền tảng số', code: '[09]', group: '', revenue: null },
    { stt: '3', label: 'Đại lý xổ số, bảo hiểm, bán hàng đa cấp', code: '[10]', group: '', revenue: null },
    { stt: '4', label: 'Môi giới', code: '[11]', group: '', revenue: null },
    { stt: '5', label: 'Hợp tác kinh doanh với tổ chức', code: '[12]', group: '', revenue: null },
    { stt: '6', label: 'Tổng cộng', code: '[13]', group: '', revenue: d.total, bold: true },
    { stt: 'II', label: 'Hoạt động cho thuê bất động sản', code: '[19]', group: '', revenue: null, bold: true },
  ];
}

const periodText = (d: Form01Data) =>
  `[01] Kỳ tính thuế: ${d.period === 'YEAR' ? '☒' : '☐'} [01a] Năm ${d.year}   ${d.period === 'H1' ? '☒' : '☐'} [01b] 6 tháng đầu năm ${d.year}   ${
    d.period === 'H2' ? '☒' : '☐'
  } [01c] 6 tháng cuối năm ${d.year}`;

const signLine = (d: Form01Data) => {
  const [y, m, dd] = d.signDay.split('-');
  return `..........., ngày ${dd} tháng ${m} năm ${y}`;
};

const COMMIT = 'Tôi cam đoan số liệu khai trên là đúng và chịu trách nhiệm trước pháp luật về những số liệu đã khai./.';
const NOTE =
  'Ghi chú: Hộ kinh doanh, cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống chỉ thông báo doanh thu, không khai số thuế GTGT, TNCN phải nộp. ' +
  'Mỗi nhóm ngành nghề ghi một dòng. Bản điền sẵn bằng QuickPOS — số liệu tham khảo, đối chiếu với mẫu trên Cổng thuế điện tử trước khi nộp.';

const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Định dạng số không phụ thuộc Intl (Hermes) */
export function fmtNum(v: number | null): string {
  if (v === null) return '';
  const s = String(Math.round(Math.abs(v)));
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return v < 0 ? `-${out}` : out;
}

/** HTML A4 ngang để in / lưu PDF (expo-print) */
export function form01Html(d: Form01Data): string {
  const rows = form01Rows(d)
    .map(
      (r) =>
        `<tr${r.bold ? ' class="b"' : ''}><td class="c">${h(r.stt)}</td><td>${h(r.label)}</td><td class="c">${h(r.code)}</td><td>${h(r.group)}</td>` +
        `<td class="r">${fmtNum(r.revenue)}</td>${'<td></td>'.repeat(COLUMNS.length - 5)}</tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A4 landscape; margin: 12mm; }
body { font-family: 'Times New Roman', serif; font-size: 12px; color: #000; }
.top { display: flex; justify-content: space-between; }
.c { text-align: center; } .r { text-align: right; } .b td { font-weight: bold; }
h1 { font-size: 16px; text-align: center; margin: 6px 0 2px; } h2 { font-size: 13px; margin: 10px 0 4px; }
table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #000; padding: 3px 4px; vertical-align: top; }
th { font-size: 11px; } .nb td { border: none; } .sign { display: flex; justify-content: space-between; margin-top: 16px; }
.sign div { width: 45%; text-align: center; } .i { font-style: italic; } .small { font-size: 11px; }
</style></head><body>
<div class="top"><div></div><div class="c"><b>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br/><b>Độc lập - Tự do - Hạnh phúc</b></div><div class="r"><b>Mẫu số: 01/TKN-CNKD</b><br/><span class="i small">(Kèm theo Thông tư số 89/2026/TT-BTC<br/>ngày 30/6/2026 của Bộ trưởng Bộ Tài chính)</span></div></div>
<h1>THÔNG BÁO DOANH THU/TỜ KHAI THUẾ NĂM</h1>
<p class="c i small">(Áp dụng đối với hộ kinh doanh, cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống …)</p>
<p>☒ Hộ kinh doanh, cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống</p>
<p>${periodText(d)}</p>
<p>[02] Lần đầu: ${d.first ? '☒' : '☐'} &nbsp;&nbsp; [03] Bổ sung lần thứ: ${d.first ? '....' : h(String(d.supplementNo ?? ''))}</p>
<p>[04] Người nộp thuế: <b>${h(d.taxpayer)}</b></p>
<p>[05] Mã số thuế: <b>${h(d.taxCode)}</b></p>
<p>Địa chỉ kinh doanh: ${h(d.address)}${d.phone ? ` &nbsp; Điện thoại: ${h(d.phone)}` : ''}</p>
<p>[06] Tổ chức/cá nhân kê khai, nộp thuế thay theo ủy quyền (nếu có): ........ [06.1] Mã số thuế: ........ [06.2] Văn bản ủy quyền số: ........ ngày ........</p>
<p>[07] Tên tổ chức, cá nhân cung cấp dịch vụ làm thủ tục về thuế (nếu có): ........ [07.1] Mã số thuế: ........ [07.2] Hợp đồng số: ........ ngày ........</p>
<h2>A. XÁC ĐỊNH NGHĨA VỤ THUẾ GTGT, TNCN</h2>
<p class="r i small">Đơn vị tiền: Đồng Việt Nam</p>
<table><tr>${COLUMNS.map((c) => `<th>${h(c)}</th>`).join('')}</tr>${rows}</table>
<h2>B. THUẾ TIÊU THỤ ĐẶC BIỆT</h2><p>Không phát sinh.</p>
<h2>C. THUẾ TÀI NGUYÊN, THUẾ BẢO VỆ MÔI TRƯỜNG, PHÍ BẢO VỆ MÔI TRƯỜNG</h2><p>Không phát sinh.</p>
<h2>D. THÔNG TIN NỘP THUẾ</h2><p>Không phát sinh.</p>
<h2>E. ĐỀ NGHỊ XỬ LÝ KHOẢN NỘP THỪA</h2><p>Không phát sinh.</p>
<p>${COMMIT}</p>
<div class="sign"><div><b>NHÂN VIÊN ĐẠI LÝ THUẾ</b><br/>Họ và tên: ................<br/>Chứng chỉ hành nghề số: ................</div>
<div><span class="i">${signLine(d)}</span><br/><b>NGƯỜI NỘP THUẾ hoặc<br/>ĐẠI DIỆN HỢP PHÁP CỦA NGƯỜI NỘP THUẾ</b><br/><span class="i small">(Chữ ký, ghi rõ họ tên; chức vụ và đóng dấu (nếu có)/Ký điện tử)</span><br/><br/><br/><br/><b>${h(d.taxpayer)}</b></div></div>
<p class="i small">${h(NOTE)}</p>
</body></html>`;
}

/** Cùng nội dung dạng bảng tính (sửa thêm trong Excel) */
export function form01Sheet(d: Form01Data): Sheet {
  const W = COLUMNS.length;
  const rows: (Cell | null)[][] = [];
  const merges: string[] = [];
  const line = (text: string, s: Cell['s'] = 0) => {
    rows.push([{ v: text, s }]);
    merges.push(`A${rows.length}:${colName(W - 1)}${rows.length}`);
  };
  line('Mẫu số: 01/TKN-CNKD (Kèm theo Thông tư số 89/2026/TT-BTC ngày 30/6/2026 của Bộ trưởng Bộ Tài chính)', 6);
  line('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM — Độc lập - Tự do - Hạnh phúc', 2);
  line('THÔNG BÁO DOANH THU/TỜ KHAI THUẾ NĂM', 2);
  line('☒ Hộ kinh doanh, cá nhân kinh doanh có doanh thu năm từ 01 tỷ đồng trở xuống');
  line(periodText(d));
  line(`[02] Lần đầu: ${d.first ? '☒' : '☐'}    [03] Bổ sung lần thứ: ${d.first ? '' : String(d.supplementNo ?? '')}`);
  line(`[04] Người nộp thuế: ${d.taxpayer}`, 1);
  line(`[05] Mã số thuế: ${d.taxCode}`, 1);
  line(`Địa chỉ kinh doanh: ${d.address}${d.phone ? `    Điện thoại: ${d.phone}` : ''}`);
  line('[06] Tổ chức/cá nhân kê khai, nộp thuế thay theo ủy quyền (nếu có):    [06.1] Mã số thuế:    [06.2] Văn bản ủy quyền số, ngày:');
  line('[07] Tên tổ chức, cá nhân cung cấp dịch vụ làm thủ tục về thuế (nếu có):    [07.1] Mã số thuế:    [07.2] Hợp đồng số, ngày:');
  line('A. XÁC ĐỊNH NGHĨA VỤ THUẾ GTGT, TNCN (đơn vị: đồng)', 1);
  rows.push(COLUMNS.map((c) => ({ v: c, s: 5 })));
  for (const r of form01Rows(d)) {
    const s = r.bold ? 5 : 4;
    rows.push(
      COLUMNS.map((_, i) =>
        i === 0 ? { v: r.stt, s } : i === 1 ? { v: r.label, s } : i === 2 ? { v: r.code, s } : i === 3 ? { v: r.group, s: 4 }
          : i === REVENUE_COL ? { v: r.revenue, s: 3 } : { v: null, s: 3 },
      ),
    );
  }
  rows.push([]);
  line('B. THUẾ TIÊU THỤ ĐẶC BIỆT: không phát sinh.');
  line('C. THUẾ TÀI NGUYÊN, THUẾ BẢO VỆ MÔI TRƯỜNG, PHÍ BẢO VỆ MÔI TRƯỜNG: không phát sinh.');
  line('D. THÔNG TIN NỘP THUẾ: không phát sinh.');
  line('E. ĐỀ NGHỊ XỬ LÝ KHOẢN NỘP THỪA: không phát sinh.');
  line(COMMIT);
  rows.push([]);
  rows.push([{ v: 'NHÂN VIÊN ĐẠI LÝ THUẾ', s: 2 }, null, null, null, null, null, { v: signLine(d), s: 7 }]);
  merges.push(`A${rows.length}:D${rows.length}`, `G${rows.length}:${colName(W - 1)}${rows.length}`);
  rows.push([{ v: 'Họ và tên:', s: 0 }, null, null, null, null, null, { v: 'NGƯỜI NỘP THUẾ hoặc ĐẠI DIỆN HỢP PHÁP CỦA NGƯỜI NỘP THUẾ', s: 2 }]);
  merges.push(`A${rows.length}:D${rows.length}`, `G${rows.length}:${colName(W - 1)}${rows.length}`);
  rows.push([{ v: 'Chứng chỉ hành nghề số:', s: 0 }, null, null, null, null, null, { v: '(Chữ ký, ghi rõ họ tên; chức vụ và đóng dấu (nếu có)/Ký điện tử)', s: 6 }]);
  merges.push(`A${rows.length}:D${rows.length}`, `G${rows.length}:${colName(W - 1)}${rows.length}`);
  rows.push([], []);
  rows.push([null, null, null, null, null, null, { v: d.taxpayer, s: 2 }]);
  merges.push(`G${rows.length}:${colName(W - 1)}${rows.length}`);
  rows.push([]);
  line(NOTE, 6);
  return { name: '01-TKN-CNKD', rows, merges, cols: [6, 34, 9, 36, 16, 14, 14, 14, 16, 16, 14] };
}

export const form01Xlsx = (d: Form01Data): Uint8Array => buildXlsx(form01Sheet(d));

export function form01FileName(d: Form01Data, ext: 'pdf' | 'xlsx'): string {
  const p = d.period === 'YEAR' ? `nam-${d.year}` : d.period === 'H1' ? `6-thang-dau-${d.year}` : `6-thang-cuoi-${d.year}`;
  return `01-TKN-CNKD-${d.taxCode.replace(/[^0-9-]/g, '')}-${p}.${ext}`;
}
