import { useQuery } from '@tanstack/react-query';
import { readPlan } from './api';
import { planStatus, type PlanStatus } from './license';
import { planNow } from '../lan/deviceMode';
import { ENV } from '../../lib/env';

/** Gói của quán (chỉ chế độ lưu trên máy). Khóa query bắt đầu bằng 'plan'. */
export function usePlan(businessId: string) {
  const q = useQuery({ queryKey: ['plan', businessId], queryFn: () => readPlan(businessId), enabled: ENV.demo && !!businessId });
  const status: PlanStatus | null = q.data ? planStatus({ businessId, ...q.data, now: planNow() }) : null;
  return { ...q, status };
}
