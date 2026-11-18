import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { HttpError } from '@tangent/api-client';
import { EmptyCard, LoginPage, useHue, t as tr } from '@tangent/web-ui';
import { session } from '../../app/client';

/** Signs in to the school named in the address: password first, then the code. */
export function LoginRoute() {
  const { slug, client } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  // A school that does not exist is final; a server restarting (or waking up on the free tier) is tried again.
  const brand = useQuery({
    queryKey: ['brand', slug], queryFn: client.api.brand, staleTime: 5 * 60_000,
    retry: (n, e) => !(e instanceof HttpError && e.status === 404) && n < 6, retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
  });
  useHue(brand.data?.hue);
  if (brand.isError) return <NoSchool error={brand.error} retry={() => void brand.refetch()} busy={brand.isFetching} />;
  const b = brand.data;
  return (
    <LoginPage
      controller={{
        product: 'admin', schoolName: b?.name ?? tr('admin.login_route.tangent'), shortName: b?.shortName ?? 'school', color: b?.color, logoText: b?.logoText, logoUrl: b?.logoUrl, privacy: b?.privacy, demoMode: !!b?.demoMode, goName: tr('admin.login_route.the_dashboard'),
        initialEmail: (() => { try { return localStorage.getItem(`tangent.admin.${slug}.email`) ?? ''; } catch { return ''; } })(),
        submitCredentials: async (email, password) => {
          const res = await client.api.login({ identifier: email, password });
          try { localStorage.setItem(`tangent.admin.${slug}.email`, email); } catch { /* ignore */ }
          if (res.step === 'otp') return res.challenge;
          session.write(slug, { user: res.tokens.user });
          session.setAccess(slug, res.tokens.accessToken);
          return null;
        },
        submitCode: async (challengeId, code) => {
          const t = await client.api.verify({ challengeId, code, client: 'web' });
          session.write(slug, { user: t.user });
          session.setAccess(slug, t.accessToken);
          return t.user.name;
        },
        resetStart: (identifier) => client.api.resetStart(identifier),
        resetFinish: async (challengeId, code, password) => { await client.api.resetFinish({ challengeId, code, password }); },
        enter: () => void navigate({ to: '/' }),
      }}
    />
  );
}

function NoSchool({ error, retry, busy }: { error: Error; retry: () => void; busy: boolean }) {
  const missing = error instanceof HttpError && error.status === 404;
  return (
    <div className="nest" style={{ minHeight: '100dvh', padding: 12, display: 'grid', placeItems: 'center' }}>
      <div style={{ maxWidth: 440, width: '100%' }}>
        {missing
          ? <EmptyCard error title={tr('admin.login_route.sign_in')} chip={{ text: tr('admin.login_route.not_found'), tone: 'c' }} icon="search" heading={tr('admin.login_route.we_couldn_t_find_that')} body={error.message} actions={<a className="btn pri" href="/">{tr('admin.login_route.try_another_address')}</a>} />
          : <EmptyCard error title={tr('admin.login_route.sign_in')} chip={{ text: tr('admin.login_route.not_answering'), tone: 'a' }} icon="warning" heading={tr('admin.login_route.the_school_isn_t_answering')} body={error instanceof HttpError ? error.message : tr('admin.login_route.check_your_connection_then_try')} actions={<button className="btn pri" disabled={busy} onClick={retry}>{busy ? tr('admin.login_route.trying') : tr('admin.login_route.try_again')}</button>} />}
      </div>
    </div>
  );
}
