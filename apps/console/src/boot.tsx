import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { clearBusy, hasUnsaved, markBusy, markDone, markSaved, quietFields } from '@tangent/web-ui';
import './console.css';
import { makeRouter } from './router';

// After any change that worked, every query on screen is fetched again (the rest go stale), so a page never keeps a row
// it just approved because its mutation named the wrong keys. It runs after the page's own refresh and skips what is
// already loading, so nothing is asked for twice. Not returned: the button stops spinning at once.
// Coming back to the tab fetches what went stale, unless a page holds unsaved edits a fresh copy would overwrite.
const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: () => !hasUnsaved() } },
  mutationCache: new MutationCache({
    onSuccess: (_d, _v, _c, m) => { markSaved(); markDone(m); setTimeout(() => void queryClient.invalidateQueries(undefined, { cancelRefetch: false })); },
    // The button that started a change shows a spinner until it is done (every change, however its page wrote it).
    onMutate: (_v, m) => markBusy(m),
    onSettled: (_d, _e, _v, _c, m) => clearBusy(m),
  }),
});
const router = makeRouter();

quietFields();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
