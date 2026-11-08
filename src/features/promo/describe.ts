/** Mô tả chương trình khuyến mãi bằng chữ (danh sách, màn bán). */
import { formatVND } from '../../lib/money';
import { vi } from '../../i18n/vi';
import { dayToVN } from '../shop/inventory';
import { isRunning, type Promotion } from './engine';

export function promoSummary(p: Promotion, productNames: Map<string, string>, categoryNames: Map<string, string>): string {
  const s = vi.inv.promoSummary;
  const value = p.percent != null ? s.pct(p.percent) : s.amt(formatVND(p.amount ?? 0));
  if (p.kind === 'ITEM_DISCOUNT') {
    const target = p.product_id ? productNames.get(p.product_id) ?? '' : categoryNames.get(p.category_id ?? '') ?? '';
    return `${target}: ${value}`;
  }
  if (p.kind === 'BUY_X_GET_Y') {
    const name = productNames.get(p.product_id ?? '') ?? '';
    const gift = productNames.get(p.get_product_id ?? p.product_id ?? '') ?? '';
    return `${name}: ${s.buy(p.buy_qty ?? 0, p.get_qty ?? 0, gift)}`;
  }
  return p.min_total ? `${value} · ${s.min(formatVND(p.min_total))}` : value;
}

export function promoStatus(p: Promotion, today: string): { running: boolean; label: string } {
  if (isRunning(p, today)) return { running: true, label: p.ends_on ? `${vi.inv.promoActive} ${vi.inv.promoUntil(dayToVN(p.ends_on))}` : vi.inv.promoActive };
  if (!p.is_active) return { running: false, label: vi.inv.promoPaused };
  if (p.ends_on && p.ends_on < today) return { running: false, label: vi.inv.promoEnded };
  if (p.starts_on && p.starts_on > today) return { running: false, label: vi.inv.promoUpcoming(dayToVN(p.starts_on)) };
  return { running: false, label: vi.inv.promoPaused };
}
