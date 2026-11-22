import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { SETTINGS_META, TIGHTEN, settingOwner, type SettingKey } from '@tangent/contracts';
import { EmptyNote, ErrorLine, Field, SettingRow, useShake, t, useUnsaved, Skeleton } from '@tangent/web-ui';
import { useApp } from './context';
import { useShellChrome } from './Layout';
import { Card, Page, useToast } from './Page';
import { usePageTabs } from './tabs';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings as the school changes them itself (docs/one-shot-plan.md §3.1): its own are editable for people with
 * `settings.manage` (and the module's write permission), saved together with an optional reason; a risky one goes to
 * Approvals for a second person; Tangent's own and the ones Tangent locked show read-only with the reason.
 */
export function SettingsEditor({ keys: asked, title = t('admin.settings_view.settings'), say }: { keys: string[]; title?: string; say: (text: string, tone?: 'ok' | 'bad') => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const shake = useShake();
  const keys = asked.filter((k): k is SettingKey => k in SETTINGS_META && !SETTINGS_META[k as SettingKey].notUsedYet);
  const q = useQuery({ queryKey: ['settings-edit'], queryFn: app.api.settings.edit });
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const v = q.data;
  const can = app.user.permissions.includes('settings.manage');
  const locked = (k: string) => v?.locks.find((l) => l.key === k);
  const value = (k: string) => (k in edits ? edits[k] : v?.values[k]);
  const changed = v ? Object.keys(edits).filter((k) => keys.includes(k as SettingKey) && !same(edits[k], v.values[k])) : [];
  useUnsaved(changed.length > 0);
  const save = useMutation({
    mutationFn: () => app.api.settings.change({ expectedVersion: v!.version, changes: Object.fromEntries(changed.map((k) => [k, edits[k]])), note: note.trim() }),
    onSuccess: (r) => {
      setEdits({}); setNote(''); setErr({});
      void qc.invalidateQueries({ queryKey: ['settings-edit'] });
      void qc.invalidateQueries({ queryKey: ['config'] });
      void qc.invalidateQueries({ queryKey: ['settings'] });
      say('pending' in r ? t('admin.settings_view.sent_for_a_second_person') : t('admin.settings_view.saved_the_admin_and_the'));
    },
    onError: (e) => {
      setErr(e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message });
      if (e instanceof HttpError && e.code === 'conflict') void qc.invalidateQueries({ queryKey: ['settings-edit'] });
      shake.hit();
    },
  });
  const why = (k: SettingKey) => {
    const lock = locked(k);
    if (settingOwner(k) === 'tangent') return t('admin.settings_view.set_by_tangent_for_your');
    if (lock) return `${TIGHTEN[k] ? t('admin.settings_view.tangent_sets_the_minimum_here') : t('admin.settings_view.set_by_tangent_for_your_2')}${lock.note ? ` ${lock.note}` : ''}`;
    return SETTINGS_META[k].help;
  };
  if (q.isLoading && !v) return <Skeleton kind="form" rows={4} />;
  if (q.isError && !v) return <Card title={title}><ErrorLine>{(q.error as Error).message}</ErrorLine><button className="btn sm" style={{ marginTop: 8 }} onClick={() => void q.refetch()}>{t('admin.settings_view.try_again')}</button></Card>;
  if (!v) return null;
  return (
    <div className={shake.cls}>
      <Card title={title} chip={changed.length ? <span className="chip a">{changed.length} {t('admin.settings_view.unsaved')}</span> : undefined}>
        {!keys.length && <EmptyNote icon="setup" title={t('admin.settings_view.nothing_to_set_here')} body={t('admin.settings_view.this_part_of_the_school')} />}
        {!can && keys.length > 0 && <div className="help" style={{ marginTop: 0 }}>{t('admin.settings_view.you_can_see_these_settings')}</div>}
        {keys.map((k) => {
          // A floor (security, privacy) still lets the school be stricter, so it stays editable.
          const readOnly = !can || settingOwner(k) === 'tangent' || (!!locked(k) && !TIGHTEN[k]);
          return <SettingRow key={k} meta={SETTINGS_META[k]} value={value(k)} error={err[k]} disabled={readOnly} ctx={{ ...v, previewDocument: app.api.settings.previewDocument }} note={why(k)} onChange={(x) => { setEdits((e) => ({ ...e, [k]: x })); setErr({}); }} />;
        })}
        {can && keys.some((k) => settingOwner(k) === 'school') && (
          <div style={{ marginTop: 16 }}>
            {err._ && <ErrorLine>{err._}</ErrorLine>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}><Field label={t('admin.settings_view.why_optional_kept_in_the')} value={note} onChange={setNote} maxLength={200} placeholder={t('admin.settings_view.for_example_the_board_changed')} /></div>
              <button className="btn" disabled={!changed.length || save.isPending} onClick={() => { setEdits({}); setErr({}); }}>{t('admin.settings_view.discard')}</button>
              <button className="btn pri" disabled={!changed.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? t('admin.settings_view.saving') : changed.length > 1 ? t('admin.settings_view.save_changes', { length: changed.length }) : t('admin.settings_view.save')}</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Any page's Settings tab (`<page>/settings`): the page's own title and tabs, and the settings its module puts there. */
export function SettingsTab({ path }: { path: string }) {
  const { shell } = useShellChrome();
  const { tabs } = usePageTabs(path);
  const { toast, say } = useToast();
  const page = shell?.menu.flatMap((g) => g.pages).find((p) => p.href === path);
  return (
    <Page title={page?.label ?? t('admin.settings_view.settings')} sub={t('admin.settings_view.how_this_part_of_the')} toast={toast} tabs={tabs}>
      <SettingsEditor keys={page?.settings ?? []} say={say} />
    </Page>
  );
}
