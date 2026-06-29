import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      // Always refetch when a screen mounts, so switching tabs pulls fresh data.
      // Cached data still renders instantly while the refetch runs in the
      // background (no spinner flash), then updates in place when it returns.
      refetchOnMount: 'always',
      staleTime: 30_000,
    },
  },
});
