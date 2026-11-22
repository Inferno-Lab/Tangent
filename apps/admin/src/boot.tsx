import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { hasUnsaved, quietFields } from '@tangent/web-ui';
import { readSupportHash } from './app/client';
import { resolveSchool } from './app/school';
import { makeRouter } from './router';
import { SchoolPicker } from './pages/status/SchoolPicker';
import { StatusBoard } from './pages/status/StatusBoard';

// After any change that worked, every query on screen is fetched again (the rest go stale), so a page never keeps a row
// it just approved because its mutation named the wrong keys. It runs after the page's own refresh and skips what is
// already loading, so nothing is asked for twice. Not returned: the button stops spinning at once.
// Coming back to the tab fetches what went stale, unless a page holds unsaved edits a fresh copy would overwrite.
const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: () => !hasUnsaved() } },
  mutationCache: new MutationCache({ onSuccess: () => { setTimeout(() => void queryClient.invalidateQueries(undefined, { cancelRefetch: false })); } }),
});
const { slug, basepath } = resolveSchool();

quietFields();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname.replace(/\/$/, '') === '/status' ? (
      <QueryClientProvider client={queryClient}><StatusBoard /></QueryClientProvider>
    ) : slug ? (
      <QueryClientProvider client={queryClient}>
        <Boot slug={slug} basepath={basepath} />
      </QueryClientProvider>
    ) : <SchoolPicker />}
  </StrictMode>,
);

function Boot({ slug, basepath }: { slug: string; basepath: string }) {
  readSupportHash(slug);
  const router = useRouterOnce(slug, basepath);
  return <RouterProvider router={router} />;
}

let cached: ReturnType<typeof makeRouter> | null = null;
function useRouterOnce(slug: string, basepath: string) {
  cached ??= makeRouter(slug, basepath);
  return cached;
}
