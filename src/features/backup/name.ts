import { fold } from '../shop/inventory';

/** Tên file sao lưu: QuickPOS-tap-hoa-co-tu-2026-11-07.json (không dấu, không ký tự lạ để gửi qua mọi app). */
export function backupFileName(shop: string, day: string): string {
  const slug = fold(shop).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'quan';
  return `QuickPOS-${slug}-${day}.json`;
}
