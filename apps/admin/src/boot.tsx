import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { quietFields } from '@tangent/web-ui';
import { readSupportHash } from './app/client';
import { resolveSchool } from './app/school';
import { makeRouter } from './router';
import { SchoolPicker } from './pages/status/SchoolPicker';
import { StatusBoard } from './pages/status/StatusBoard';

// After any change that worked, every query on screen is fetched again (the rest go stale), so a page never keeps a row
// it just approved because its mutation named the wrong keys. Not returned: the button stops spinning at once.
const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
  mutationCache: new MutationCache({ onSuccess: () => { void queryClient.invalidateQueries(); } }),
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
