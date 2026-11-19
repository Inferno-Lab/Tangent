import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './console.css';
import { makeRouter } from './router';

// After any change that worked, every query on screen is fetched again (the rest go stale), so a page never keeps a row
// it just approved because its mutation named the wrong keys. Not returned: the button stops spinning at once.
const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
  mutationCache: new MutationCache({ onSuccess: () => { void queryClient.invalidateQueries(); } }),
});
const router = makeRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
