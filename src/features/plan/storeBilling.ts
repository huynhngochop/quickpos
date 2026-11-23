/**
 * Mua gói Pro qua App Store / Google Play (thư viện expo-iap).
 *
 * Gói là thuê bao năm `ENV.proStoreSku` (mặc định quickpos_pro_year), 599.000 đ/năm, ưu đãi dùng thử miễn phí
 * 3 tháng cấu hình trên App Store Connect / Google Play Console (cửa hàng tự tính thời gian dùng thử và tự gia hạn).
 *
 * Chưa có máy chủ nên app tự hỏi cửa hàng "thuê bao còn hiệu lực không" mỗi lần mở trang chính, rồi nhớ kết quả trên máy:
 * - iOS có ngày hết hạn → nhớ tới ngày đó + 3 ngày (cửa hàng gia hạn chậm vài giờ);
 * - Android không trả ngày hết hạn → nhớ thêm 7 ngày kể từ lần hỏi được gần nhất, để quán mất mạng vài ngày vẫn dùng Pro.
 * Khi có máy chủ (Premium) sẽ xác minh biên nhận ở máy chủ.
 */
import { Platform } from 'react-native';
import Storage from 'expo-sqlite/kv-store';
import * as ExpoIap from 'expo-iap';
import { ENV } from '../../lib/env';

const DAY = 86_400_000;
const IOS_GRACE = 3 * DAY;
const ANDROID_GRACE = 7 * DAY;
const entitlementKey = (businessId: string) => `quickpos.plan.store.${businessId}`;

/** Phần của expo-iap mà app dùng (viết hẹp lại để không phụ thuộc chi tiết kiểu của từng phiên bản thư viện) */
interface IapPurchase {
  productId: string;
}
interface IapApi {
  initConnection(): Promise<boolean>;
  fetchProducts(p: { skus: string[]; type: 'subs' }): Promise<unknown[] | null>;
  requestPurchase(p: {
    request: { apple: { sku: string }; google: { skus: string[]; subscriptionOffers?: { sku: string; offerToken: string }[] } };
    type: 'subs';
  }): Promise<unknown>;
  finishTransaction(p: { purchase: IapPurchase; isConsumable?: boolean }): Promise<unknown>;
  getActiveSubscriptions(ids?: string[]): Promise<{ productId: string; isActive: boolean; expirationDateIOS?: number | null }[]>;
  purchaseUpdatedListener(cb: (p: IapPurchase) => void): { remove(): void };
  purchaseErrorListener(cb: (e: { code?: string; message?: string }) => void): { remove(): void };
  deepLinkToSubscriptions(p: { skuAndroid?: string }): Promise<void>;
}
const iap = ExpoIap as unknown as IapApi;

/** Bản build này bán Pro qua cửa hàng (bản cài từ APK ngoài cửa hàng dùng mã kích hoạt: EXPO_PUBLIC_BILLING=code) */
export const storeBillingEnabled = ENV.billing === 'store' && (Platform.OS === 'ios' || Platform.OS === 'android');

let connecting: Promise<boolean> | null = null;
function connect(): Promise<boolean> {
  connecting ??= iap.initConnection().catch(() => {
    connecting = null;
    return false;
  });
  return connecting;
}

/** Hạn Pro đã mua qua cửa hàng mà máy này nhớ (ms), hoặc null */
export function storeProUntil(businessId: string): number | null {
  try {
    const raw = Storage.getItemSync(entitlementKey(businessId));
    const until = raw ? Number(raw) : 0;
    return until > 0 ? until : null;
  } catch {
    return null;
  }
}

function rememberUntil(businessId: string, until: number | null) {
  try {
    if (until) Storage.setItemSync(entitlementKey(businessId), String(until));
    else Storage.removeItemSync(entitlementKey(businessId));
  } catch {
    /* không ghi được: lần mở app sau hỏi lại cửa hàng */
  }
}

/**
 * Hỏi cửa hàng thuê bao Pro còn hiệu lực không và nhớ kết quả. Trả hạn mới (ms) hoặc null.
 * Không kết nối được cửa hàng (mất mạng) thì giữ nguyên điều đã nhớ.
 */
export async function refreshStoreEntitlement(businessId: string): Promise<number | null> {
  if (!storeBillingEnabled || !businessId) return storeProUntil(businessId);
  if (!(await connect())) return storeProUntil(businessId);
  try {
    const subs = await iap.getActiveSubscriptions([ENV.proStoreSku]);
    const active = subs.find((s) => s.productId === ENV.proStoreSku && s.isActive);
    const until = !active
      ? null
      : active.expirationDateIOS
        ? active.expirationDateIOS + IOS_GRACE
        : Date.now() + ANDROID_GRACE;
    rememberUntil(businessId, until);
    return until;
  } catch {
    return storeProUntil(businessId);
  }
}

export interface StoreOffer {
  /** Giá cửa hàng hiển thị theo tiền của tài khoản người mua, ví dụ "599.000 ₫" */
  price: string | null;
  /** Android: mã ưu đãi (gói năm + dùng thử) cần gửi kèm khi mua */
  offerToken: string | null;
}

/** Giá và ưu đãi của gói Pro trên cửa hàng; null khi chưa lấy được (chưa cấu hình sản phẩm, mất mạng) */
export async function loadProOffer(): Promise<StoreOffer | null> {
  if (!storeBillingEnabled || !(await connect())) return null;
  try {
    const products = (await iap.fetchProducts({ skus: [ENV.proStoreSku], type: 'subs' })) ?? [];
    const p = products.find((x) => (x as { id?: string; productId?: string }).id === ENV.proStoreSku ||
      (x as { productId?: string }).productId === ENV.proStoreSku) as
      | { displayPrice?: string; subscriptionOfferDetailsAndroid?: { offerToken: string; offerId?: string | null }[] }
      | undefined;
    if (!p) return null;
    const offers = p.subscriptionOfferDetailsAndroid ?? [];
    // Ưu tiên ưu đãi dùng thử (có offerId), không có thì gói năm cơ bản
    const offer = offers.find((o) => o.offerId) ?? offers[0];
    return { price: p.displayPrice ?? null, offerToken: offer?.offerToken ?? null };
  } catch {
    return null;
  }
}

export type BuyResult = 'ok' | 'cancelled' | 'failed';

/** Mở hộp mua của cửa hàng; chờ tới khi mua xong, bị hủy hoặc lỗi. Mua xong thì ghi nhận gói và trả 'ok'. */
export async function buyPro(businessId: string, offer: StoreOffer | null): Promise<BuyResult> {
  if (!storeBillingEnabled || !(await connect())) return 'failed';
  return new Promise<BuyResult>((resolve) => {
    let done = false;
    const finish = (r: BuyResult) => {
      if (done) return;
      done = true;
      okSub.remove();
      errSub.remove();
      resolve(r);
    };
    const okSub = iap.purchaseUpdatedListener((purchase) => {
      if (purchase.productId !== ENV.proStoreSku) return;
      void (async () => {
        try {
          await iap.finishTransaction({ purchase, isConsumable: false });
        } catch {
          /* cửa hàng sẽ gửi lại giao dịch lần sau */
        }
        await refreshStoreEntitlement(businessId);
        if (!storeProUntil(businessId)) rememberUntil(businessId, Date.now() + (Platform.OS === 'ios' ? IOS_GRACE : ANDROID_GRACE));
        finish('ok');
      })();
    });
    const errSub = iap.purchaseErrorListener((e) => {
      finish(/cancel/i.test(`${e.code ?? ''} ${e.message ?? ''}`) ? 'cancelled' : 'failed');
    });
    iap
      .requestPurchase({
        request: {
          apple: { sku: ENV.proStoreSku },
          google: {
            skus: [ENV.proStoreSku],
            subscriptionOffers: offer?.offerToken ? [{ sku: ENV.proStoreSku, offerToken: offer.offerToken }] : undefined,
          },
        },
        type: 'subs',
      })
      .catch((e: { code?: string; message?: string }) => finish(/cancel/i.test(`${e?.code ?? ''} ${e?.message ?? ''}`) ? 'cancelled' : 'failed'));
  });
}

/** Mở trang quản lý thuê bao của cửa hàng (hủy, đổi phương thức trả tiền) */
export async function openSubscriptionSettings() {
  try {
    await iap.deepLinkToSubscriptions({ skuAndroid: ENV.proStoreSku });
  } catch {
    /* máy không mở được: người dùng tự vào cài đặt cửa hàng */
  }
}
