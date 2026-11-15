import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError } from '@tangent/api-client';
import { SETTINGS_META, TIGHTEN, settingOwner, type SettingKey } from '@tangent/contracts';
import { EmptyNote, ErrorLine, Field, SettingRow, useShake } from '@tangent/web-ui';
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
export function SettingsEditor({ keys: asked, title = 'Settings', say }: { keys: string[]; title?: string; say: (text: string, tone?: 'ok' | 'bad') => void }) {
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
  const save = useMutation({
    mutationFn: () => app.api.settings.change({ expectedVersion: v!.version, changes: Object.fromEntries(changed.map((k) => [k, edits[k]])), note: note.trim() }),
    onSuccess: (r) => {
      setEdits({}); setNote(''); setErr({});
      void qc.invalidateQueries({ queryKey: ['settings-edit'] });
      void qc.invalidateQueries({ queryKey: ['config'] });
      void qc.invalidateQueries({ queryKey: ['settings'] });
      say('pending' in r ? 'Sent for a second person to approve under Approvals. It applies when they do.' : 'Saved. The admin and the app follow within a minute.');
    },
    onError: (e) => {
      setErr(e instanceof HttpError && Object.keys(e.fields).length ? e.fields : { _: (e as Error).message });
      if (e instanceof HttpError && e.code === 'conflict') void qc.invalidateQueries({ queryKey: ['settings-edit'] });
      shake.hit();
    },
  });
  const why = (k: SettingKey) => {
    const lock = locked(k);
    if (settingOwner(k) === 'tangent') return 'Set by Tangent for your school. Ask Tangent to change it.';
    if (lock) return `${TIGHTEN[k] ? 'Tangent sets the minimum here; you may be stricter.' : 'Set by Tangent for your school.'}${lock.note ? ` ${lock.note}` : ''}`;
    return SETTINGS_META[k].help;
  };
  if (q.isLoading && !v) return <div className="skc" style={{ height: 240, borderRadius: 24 }} />;
  if (q.isError && !v) return <Card title={title}><ErrorLine>{(q.error as Error).message}</ErrorLine><button className="btn sm" style={{ marginTop: 8 }} onClick={() => void q.refetch()}>Try again</button></Card>;
  if (!v) return null;
  return (
    <div className={shake.cls}>
      <Card title={title} chip={changed.length ? <span className="chip a">{changed.length} unsaved</span> : undefined}>
        {!keys.length && <EmptyNote icon="setup" title="Nothing to set here" body="This part of the school has no settings of its own." />}
        {!can && keys.length > 0 && <div className="help" style={{ marginTop: 0 }}>You can see these settings but not change them. Someone with the right to change settings can.</div>}
        {keys.map((k) => {
          // A floor (security, privacy) still lets the school be stricter, so it stays editable.
          const readOnly = !can || settingOwner(k) === 'tangent' || (!!locked(k) && !TIGHTEN[k]);
          return <SettingRow key={k} meta={SETTINGS_META[k]} value={value(k)} error={err[k]} disabled={readOnly} ctx={v} note={why(k)} onChange={(x) => { setEdits((e) => ({ ...e, [k]: x })); setErr({}); }} />;
        })}
        {can && keys.some((k) => settingOwner(k) === 'school') && (
          <div style={{ marginTop: 16 }}>
            {err._ && <ErrorLine>{err._}</ErrorLine>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}><Field label="Why (optional, kept in the history)" value={note} onChange={setNote} maxLength={200} placeholder="For example: the board changed the loan period" /></div>
              <button className="btn" disabled={!changed.length || save.isPending} onClick={() => { setEdits({}); setErr({}); }}>Discard</button>
              <button className="btn pri" disabled={!changed.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : changed.length > 1 ? `Save ${changed.length} changes` : 'Save'}</button>
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
    <Page title={page?.label ?? 'Settings'} sub="How this part of the school works. Changes apply for everyone at once." toast={toast} tabs={tabs}>
      <div style={{ maxWidth: 760 }}><SettingsEditor keys={page?.settings ?? []} say={say} /></div>
    </Page>
  );
}
