// Sinh biểu tượng app từ SVG (chạy lại khi đổi thiết kế): node scripts/make-icons.mjs [đường-dẫn-sharp]
// Biểu tượng: mã QR cách điệu trắng trên nền xanh + dấu tích xanh lá = "quét là biết tiền về".
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] ?? 'sharp');
const out = new URL('../assets/images/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const BLUE = '#1D4ED8';
const GREEN = '#0B6B35';

// Ô định vị QR (3 góc) + vài chấm dữ liệu, vẽ trên lưới 1024
function qrMark(color, bg) {
  const finder = (x, y) => `
    <rect x="${x}" y="${y}" width="150" height="150" rx="28" fill="${color}"/>
    <rect x="${x + 30}" y="${y + 30}" width="90" height="90" rx="14" fill="${bg}"/>
    <rect x="${x + 52}" y="${y + 52}" width="46" height="46" rx="8" fill="${color}"/>`;
  const dots = [
    [472, 302], [532, 362], [472, 422],
    [302, 472], [382, 472], [472, 472], [612, 472], [682, 532],
    [532, 532], [472, 602], [532, 682],
  ]
    .map(([x, y]) => `<rect x="${x}" y="${y}" width="48" height="48" rx="10" fill="${color}"/>`)
    .join('');
  return finder(282, 282) + finder(592, 282) + finder(282, 592) + dots;
}

const check = (cx, cy, r) => `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${GREEN}" stroke="#FFFFFF" stroke-width="${r * 0.14}"/>
  <path d="M ${cx - r * 0.42} ${cy + r * 0.02} L ${cx - r * 0.1} ${cy + r * 0.34} L ${cx + r * 0.45} ${cy - r * 0.32}"
        fill="none" stroke="#FFFFFF" stroke-width="${r * 0.2}" stroke-linecap="round" stroke-linejoin="round"/>`;

// iOS + Android cũ: hình vuông đầy, không trong suốt (App Store từ chối icon có alpha)
const full = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="${BLUE}"/>
  <g transform="translate(512 512) scale(1.22) translate(-512 -512)">
    <rect x="232" y="232" width="560" height="560" rx="64" fill="#FFFFFF"/>
    ${qrMark(BLUE, '#FFFFFF')}
    ${check(742, 742, 130)}
  </g>
</svg>`;

// Android adaptive: phần trước (trong suốt, nội dung trong vùng an toàn 66%), nền đặt màu trong app.json
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <g transform="translate(512 512) scale(0.8) translate(-512 -512)">
    <rect x="232" y="232" width="560" height="560" rx="64" fill="#FFFFFF"/>
    ${qrMark(BLUE, '#FFFFFF')}
    ${check(742, 742, 130)}
  </g>
</svg>`;

// Android 13+ biểu tượng một màu
const monochrome = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <g transform="translate(512 512) scale(0.8) translate(-512 -512)">${qrMark('#000000', 'rgba(0,0,0,0)')}</g>
</svg>`;

// Thông báo Android: trắng trên nền trong suốt, 96x96
const notification = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 1024 1024">
  ${qrMark('#FFFFFF', 'rgba(0,0,0,0)')}
</svg>`;

// Màn chờ khi mở app
const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect x="232" y="232" width="560" height="560" rx="96" fill="${BLUE}"/>
  ${qrMark('#FFFFFF', BLUE)}
  ${check(742, 742, 130)}
</svg>`;

const jobs = [
  ['icon.png', full, 1024],
  ['adaptive-icon.png', foreground, 1024],
  ['adaptive-icon-monochrome.png', monochrome, 1024],
  ['notification-icon.png', notification, 96],
  ['splash-icon.png', splash, 1024],
  ['favicon.png', full, 48],
];
for (const [name, svg, size] of jobs) {
  let img = sharp(Buffer.from(svg)).resize(size, size).png();
  if (name === 'icon.png') img = img.flatten({ background: BLUE }); // bỏ kênh alpha cho iOS
  await img.toFile(out + name);
  console.log('ok', name);
}
