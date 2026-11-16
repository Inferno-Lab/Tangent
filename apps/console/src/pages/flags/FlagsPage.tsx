import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlagRow } from '@tangent/contracts';
import { Dialog, Field, MenuButton, useShake, EmptyState, t } from '@tangent/web-ui';
import { Card, Page, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { ago } from '../../app/format';

type Ask = { key: string; label: string; enabled: boolean; schoolId: string | null; what: string } | { remove: FlagRow };

/**
 * Switches for features still being finished: off for everyone, on for one school first, then for everyone. Pausing a module
 * that is in trouble is on Plans and modules, not here (`kill.*` flags are kept out of this list).
 */
export function FlagsPage() {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState<Ask | null>(null);
  const [menuFor, setMenuFor] = useState('');
  const shake = useShake();
  const flags = useQuery({ queryKey: ['flags'], queryFn: app.api.flags.list });
  const schools = useQuery({ queryKey: ['schools'], queryFn: () => app.api.schools() });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['flags'] });
  const set = useMutation({
    mutationFn: (b: { key: string; enabled: boolean; schoolId?: string | null; label?: string }) => app.api.flags.set(b.key, { enabled: b.enabled, schoolId: b.schoolId, label: b.label }),
    onSuccess: () => { refresh(); setAsk(null); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const remove = useMutation({
    mutationFn: (f: FlagRow) => app.api.flags.remove(f.key, f.schoolId),
    onSuccess: (_, f) => { refresh(); setAsk(null); say(f.schoolId ? t('console.flags_page.cleared_for_that_school_it') : t('console.flags_page.flag_deleted')); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const rows = (flags.data ?? []).filter((f) => !f.key.startsWith('kill.'));
  const fleet = rows.filter((f) => f.scope === 'fleet');
  const per = (k: string) => rows.filter((f) => f.scope === 'school' && f.key === k);
  const canWrite = app.can('flags.write');
  const name = (id: string | null) => schools.data?.find((s) => s.id === id)?.name ?? t('console.flags_page.a_school');
  const add = () => {
    if (!/^[a-z][a-z0-9._-]{2,40}$/.test(key)) { setErr(t('console.flags_page.use_lowercase_letters_numbers_dots')); shake.hit(); return; }
    if (key.startsWith('kill.')) { setErr(t('console.flags_page.pausing_a_module_is_done')); shake.hit(); return; }
    set.mutate({ key, enabled: false, label: label.trim() || key }, { onSuccess: () => { setKey(''); setLabel(''); say(t('console.flags_page.flag_added_switched_off_for')); } });
  };
  return (
    <Page title={t('console.flags_page.flags')} sub={t('console.flags_page.switch_a_feature_on_for')} toast={toast} loading={flags.isLoading} error={flags.isError ? { message: (flags.error as Error).message, retry: () => void flags.refetch() } : null}
      overlays={ask && (
        <Dialog title={'remove' in ask ? t('console.flags_page.delete', { label: ask.remove.label }) : ask.what} tag={{ text: 'remove' in ask ? t('console.flags_page.every_school') : ask.schoolId ? name(ask.schoolId) : t('console.flags_page.every_school'), tone: 'a' }} onClose={() => setAsk(null)} width={460}>
          <p style={{ marginTop: 0 }}>{'remove' in ask ? t('console.flags_page.the_code_that_reads_it') : ask.schoolId ? t('console.flags_page.only_this_school_changes_it') : t('console.flags_page.every_school_changes_within_a')}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" onClick={() => setAsk(null)}>{t('console.flags_page.cancel')}</button>
            {'remove' in ask
              ? <button className="btn dngf" disabled={remove.isPending} onClick={() => remove.mutate(ask.remove)}>{t('console.flags_page.delete_2')}</button>
              : <button className="btn pri" disabled={set.isPending} onClick={() => set.mutate({ key: ask.key, enabled: ask.enabled, schoolId: ask.schoolId, label: ask.label })}>{ask.enabled ? t('console.flags_page.switch_on') : t('console.flags_page.switch_off')}</button>}
          </div>
        </Dialog>
      )}>
      <Card title={t('console.flags_page.flags')} chip={<span className="chip">{fleet.length}</span>}>
        {fleet.length === 0 && <EmptyState scene="flags" onAction={canWrite ? () => document.querySelector<HTMLInputElement>('input[name="flag-new"]')?.focus() : undefined} />}
        {fleet.map((f) => (
          <div key={f.key} style={{ padding: '16px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px', minWidth: 0 }}><b style={{ font: '700 14px var(--fb)', display: 'block' }}>{f.label}</b><small style={{ font: '400 13px var(--fb)', color: 'var(--ink3)' }}>{f.key} {t('console.flags_page.changed')}{' '}{ago(f.updatedAt)} {t('console.flags_page.by')}{' '}{f.updatedBy}</small></div>
              {canWrite && (
                <MenuButton label={t('console.flags_page.for_one_school')} chevron open={menuFor === f.key} onOpenChange={(o) => setMenuFor(o ? f.key : '')} menuLabel={t('console.flags_page.choose_a_school')}>
                  {(schools.data ?? []).filter((s) => !per(f.key).some((x) => x.schoolId === s.id)).map((s) => (
                    <button key={s.id} role="menuitem" onClick={() => { setMenuFor(''); setAsk({ key: f.key, label: f.label, enabled: !f.enabled, schoolId: s.id, what: t('console.flags_page.at', { p0: f.enabled ? 'Switch off' : 'Switch on', label: f.label, name: s.name }) }); }}>{s.name}</button>
                  ))}
                </MenuButton>
              )}
              {canWrite && <button className="btn sm dng" onClick={() => setAsk({ remove: f })}>{t('console.flags_page.delete_2')}</button>}
              <span className="lbl" style={{ margin: 0 }}>{t('console.flags_page.everyone')}</span>
              <button className={`sw ${f.enabled ? 'on' : ''}`} role="switch" aria-checked={f.enabled} aria-label={t('console.flags_page.for_everyone', { label: f.label })} disabled={!canWrite}
                onClick={() => setAsk({ key: f.key, label: f.label, enabled: !f.enabled, schoolId: null, what: t('console.flags_page.for_everyone_2', { p0: f.enabled ? 'Switch off' : 'Switch on', label: f.label }) })}></button>
            </div>
            {per(f.key).map((x) => (
              <div key={x.schoolId} className="kv" style={{ paddingLeft: 24 }}>
                <span>{name(x.schoolId)}<br /><small style={{ color: 'var(--ink3)' }}>{t('console.flags_page.set_on_its_own')}{' '}{ago(x.updatedAt)} {t('console.flags_page.by')}{' '}{x.updatedBy}</small></span>
                <b style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {canWrite && <button className="btn sm" onClick={() => remove.mutate(x)}>{t('console.flags_page.follow_everyone')}</button>}
                  <button className={`sw ${x.enabled ? 'on' : ''}`} role="switch" aria-checked={x.enabled} aria-label={t('console.flags_page.at_2', { label: f.label, name: name(x.schoolId) })} disabled={!canWrite}
                    onClick={() => setAsk({ key: f.key, label: f.label, enabled: !x.enabled, schoolId: x.schoolId, what: t('console.flags_page.at', { p0: x.enabled ? 'Switch off' : 'Switch on', label: f.label, name: name(x.schoolId) }) })}></button>
                </b>
              </div>
            ))}
          </div>
        ))}
      </Card>
      {canWrite && (
        <Card title={t('console.flags_page.new_flag')}>
          <div className={shake.cls} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(240px,100%),1fr))', gap: 12 }}>
            <Field label={t('console.flags_page.key')} name="flag-new" value={key} onChange={(v) => { setKey(v); setErr(''); }} error={err} placeholder="new.report-cards" hint={t('console.flags_page.the_name_the_code_checks')} />
            <Field label={t('console.flags_page.what_it_does')} value={label} onChange={setLabel} placeholder={t('console.flags_page.new_report_card_layout')} />
          </div>
          <button className="btn pri" style={{ marginTop: 12 }} onClick={add} disabled={set.isPending}>{t('console.flags_page.add_flag')}</button>
        </Card>
      )}
    </Page>
  );
}
