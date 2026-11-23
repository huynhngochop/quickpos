export interface PlanRow {
  trialStartedAt: string | null;
  licenseCode: string | null;
  /** Hạn thuê bao Pro mua qua App Store / Google Play mà máy này nhớ (ms), xem storeBilling.ts */
  storeProUntil?: number | null;
}
