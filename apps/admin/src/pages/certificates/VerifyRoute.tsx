import { useQuery } from '@tanstack/react-query';
import { useParams, useRouteContext } from '@tanstack/react-router';
import { EmptyCard, LogoImage, useHue, t } from '@tangent/web-ui';

/**
 * What a certificate's QR code opens, for anyone (an employer, another school): whether the certificate is genuine, with only
 * what identifies it. Nobody signs in; a revoked or unknown code says so.
 */
export function VerifyRoute() {
  const { slug, client } = useRouteContext({ from: '__root__' });
  const { token } = useParams({ strict: false }) as { token: string };
  const brand = useQuery({ queryKey: ['brand', slug], queryFn: client.api.brand, staleTime: 5 * 60_000 });
  const check = useQuery({ queryKey: ['verify', token], queryFn: () => client.api.certificates.verify(token), retry: false });
  useHue(brand.data?.hue);
  const b = brand.data;
  const c = check.data;
  const body = check.isLoading ? <div className="skc" style={{ height: 240, borderRadius: 24 }} />
    : !c || check.isError ? <EmptyCard title={t('admin.verify.certificate')} chip={{ text: t('admin.verify.not_found'), tone: 'c' }} icon="warning" heading={t('admin.verify.not_ours')} body={t('admin.verify.not_ours_body', { school: b?.name ?? '' })} />
      : c.genuine ? <EmptyCard title={c.type ?? t('admin.verify.certificate')} chip={{ text: t('admin.verify.genuine'), tone: 'g' }} icon="checkCircle" heading={t('admin.verify.genuine_heading', { school: c.school })}
        body={t('admin.verify.genuine_body', { number: c.number ?? '', student: c.student ?? '', date: c.issuedOn ?? '' })} />
        : c.revoked ? <EmptyCard title={c.type ?? t('admin.verify.certificate')} chip={{ text: t('admin.verify.revoked'), tone: 'c' }} icon="warning" heading={t('admin.verify.revoked_heading')} body={t('admin.verify.revoked_body', { number: c.number ?? '', school: c.school })} />
          : <EmptyCard title={t('admin.verify.certificate')} chip={{ text: t('admin.verify.not_found'), tone: 'c' }} icon="warning" heading={t('admin.verify.not_ours')} body={t('admin.verify.not_ours_body', { school: c.school })} />;
  return (
    <div className="nest" style={{ minHeight: '100dvh', padding: 16, background: 'var(--bg)' }}>
      <main style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBlock: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LogoImage src={b?.logoUrl} style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover' }} />
          <h1 className="fd" style={{ margin: 0, overflowWrap: 'anywhere' }}>{b?.name ?? ''}</h1>
        </div>
        {body}
      </main>
    </div>
  );
}
