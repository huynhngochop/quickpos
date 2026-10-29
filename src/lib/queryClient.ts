import { QueryClient } from '@tanstack/react-query';
import { toAppError } from './errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Thử lại do lớp callWithRetry lo (đúng nhịp 1 s, 3 s, 9 s); ở đây chỉ thử thêm lỗi mạng một lần
      retry: (count, err) => count < 1 && toAppError(err).retryable,
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      refetchOnReconnect: true,
    },
    mutations: { retry: false },
  },
});
