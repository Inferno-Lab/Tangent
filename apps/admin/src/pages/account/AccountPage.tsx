import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { dashboardPieces } from '@tangent/config-engine';
import { Field, useShake, useTheme, useToast, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { problem } from '../../app/kit';
import { useShellChrome } from '../../app/Layout';
import { Card, Page } from '../../app/Page';

/** The signed-in person's own account: who they are here, their password, where they are signed in, and the shortcuts. */
export function AccountPage() {
  const app = useApp();
  const { shell } = useShellChrome();
  const theme = useTheme();
  const { toast, say } = useToast();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const shake = useShake();
  const change = useMutation({
    mutationFn: () => app.api.changePassword({ current: f.current, next: f.next }),
    onSuccess: () => { setF({ current: '', next: '', again: '' }); say(t('admin.account_page.password_changed_every_other_device')); },
    onError: (e) => { setErr(problem(e)); shake.hit(); },
  });
  const everywhere = useMutation({ mutationFn: app.api.logoutAll, onSuccess: app.signOut, onError: (e) => say((e as Error).message, 'bad') });
  const go = () => {
    if (f.next !== f.again) { setErr({ again: t('admin.account_page.the_two_new_passwords_are') }); shake.hit(); return; }
    change.mutate();
  };
  const set = (k: keyof typeof f) => (v: string) => { setF({ ...f, [k]: v }); setErr({}); };
  const pages = (shell?.menu ?? []).flatMap((g) => g.pages);
  const news = dashboardPieces({ modules: shell?.modules ?? [], features: shell?.features ?? [] }, app.user.permissions).filter((p) => p.kind === 'new' && p.keys);
  return (
    <Page title={t('admin.account_page.my_account')} sub={app.user.name} toast={toast}>
      <section className="grid" data-even="">
        <Card span="s6" title={t('admin.account_page.you_at_the_school')}>
          <div className="kv"><span>{t('admin.account_page.name')}</span><b>{app.user.name}</b></div>
          <div className="kv"><span>{t('admin.account_page.signs_in_with')}</span><b>{app.user.email || app.user.phone || '–'}</b></div>
          <div className="kv" style={{ alignItems: 'flex-start' }}><span>{app.user.roleNames.length === 1 ? t('admin.account_page.role') : t('admin.account_page.roles')}</span><b style={{ textAlign: 'end' }}>{app.user.roleNames.join(' · ') || t('admin.account_page.staff')}</b></div>
          <p className="help" style={{ marginBottom: 0 }}>{t('admin.account_page.the_office_changes_your_name')}</p>
          <div className="tgrow" style={{ marginTop: 12 }}>
            <button className="btn" onClick={theme.toggle}>{theme.theme === 'dark' ? t('admin.account_page.switch_to_light') : t('admin.account_page.switch_to_dark')}</button>
            <button className="btn" disabled={everywhere.isPending} onClick={() => everywhere.mutate()}>{t('admin.account_page.sign_out_on_every_device')}</button>
          </div>
        </Card>
        <Card span="s6" title={t('admin.account_page.password')}>
          <div className={`stack ${shake.cls}`}>
            <Field label={t('admin.account_page.current_password')} type="password" value={f.current} onChange={set('current')} error={err.current} />
            <Field label={t('admin.account_page.new_password')} type="password" value={f.next} onChange={set('next')} error={err.next} hint={t('admin.account_page.at_least_8_characters')} />
            <Field label={t('admin.account_page.new_password_again')} type="password" value={f.again} onChange={set('again')} error={err.again} />
            {err._ && <div className="emsg" role="alert">{err._}</div>}
            <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
              <button className="btn pri" disabled={change.isPending || !f.current || !f.next} onClick={go}>{change.isPending ? t('admin.account_page.changing') : t('admin.account_page.change_password')}</button>
            </div>
          </div>
        </Card>
        <Card span="s12" title={t('admin.account_page.keyboard_shortcuts')}>
          <div className="kv"><span>{t('admin.account_page.search_anything')}</span><b>{t('admin.account_page.ctrl_k_or')}</b></div>
          {pages.map((p) => <div key={p.id} className="kv"><span>{t('admin.account_page.go_to')}{' '}{p.label}</span><b>{p.keys}</b></div>)}
          {news.map((n) => <div key={n.key} className="kv"><span>{n.label}</span><b>{n.keys}</b></div>)}
        </Card>
      </section>
    </Page>
  );
}
