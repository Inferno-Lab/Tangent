import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeeHead } from '@tangent/contracts';
import { Checkbox, Field, useToast, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { Ico, problem, useSetting } from '../../app/kit';
import { useShellChrome } from '../../app/Layout';
import { Card, Page } from '../../app/Page';
import { useSetupSections } from '../year/SetupSections';

type Draft = { key?: string; name: string; concession: boolean };

/** The kinds of fee the school charges (fee heads) and what each class pays (fee structures). */
export function FeeStructure({ tabs }: { tabs: React.ReactNode }) {
  const { toast, say } = useToast();
  const setup = useSetupSections(['fee_structures'], say);
  return (
    <Page title={t('admin.fee_structure.fees')} sub={t('admin.fee_structure.the_kinds_of_fee_the')} toast={toast} tabs={tabs} overlays={setup.overlay}>
      <div className="stack" style={{ gap: 16 }}>
        <Rules />
        <Heads say={say} />
        {setup.view}
      </div>
    </Page>
  );
}

function Heads({ say }: { say: (text: string, tone?: 'bad') => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fee-heads'], queryFn: app.api.fees.heads });
  // The school edits its own fee heads unless Tangent keeps them (console: Fees → the school edits its fee structures).
  const open = useSetting<boolean>('feeStructures.schoolEdits', true);
  const may = open && app.user.permissions.includes('setup.write');
  const [draft, setDraft] = useState<Draft[]>([]);
  const [err, setErr] = useState<Record<string, string>>({});
  const reset = (h: FeeHead[]) => { setDraft(h.map((x) => ({ key: x.key, name: x.name, concession: x.concession }))); setErr({}); };
  useEffect(() => { if (q.data) reset(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: () => app.api.fees.setHeads({ heads: draft.map((d) => ({ ...(d.key ? { key: d.key } : {}), name: d.name.trim(), concession: d.concession })) }),
    onSuccess: (next) => { qc.setQueryData(['fee-heads'], next); void qc.invalidateQueries({ queryKey: ['fee-summary'] }); say(t('admin.fee_structure.fee_heads_saved')); },
    onError: (e) => { const p = problem(e); setErr(p); say(Object.values(p)[0] ?? t('admin.fee_structure.could_not_save'), 'bad'); },
  });
  const changed = JSON.stringify(draft) !== JSON.stringify((q.data ?? []).map((x) => ({ key: x.key, name: x.name, concession: x.concession })));
  const set = (i: number, p: Partial<Draft>) => setDraft(draft.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const move = (i: number, by: -1 | 1) => { const n = [...draft]; const j = i + by; [n[i], n[j]] = [n[j]!, n[i]!]; setDraft(n); };
  if (q.isLoading) return <div className="skc" style={{ height: 200, borderRadius: 16 }} />;
  return (
    <Card title={t('admin.fee_structure.fee_heads')} chip={<span className="chip">{draft.length}</span>}>
      <p className="help" style={{ margin: '0 0 12px' }}>{may
        ? t('admin.fee_structure.the_kinds_of_fee_on')
        : t('admin.fee_structure.the_kinds_of_fee_on_2')}</p>
      {draft.map((d, i) => (
        <div key={d.key ?? `new-${i}`} className="exr" style={{ padding: '8px 0', gap: 12 }}>
          <span className="rn num">{i + 1}</span>
          <div style={{ flex: 1, minWidth: 180 }}>
            {may ? <Field label={t('admin.fee_structure.fee_head', { p0: i + 1 })} value={d.name} onChange={(name) => set(i, { name })} error={err[`heads.${i}.name`]} maxLength={40} /> : <b style={{ font: '700 14px var(--fb)' }}>{d.name}</b>}
          </div>
          {may ? <Checkbox checked={d.concession} onChange={(concession) => set(i, { concession })} label={t('admin.fee_structure.concessions_apply')} /> : d.concession && <span className="chip v">{t('admin.fee_structure.concessions_apply')}</span>}
          {may && (
            <span className="tgrow">
              <button className="btn sm" aria-label={t('admin.fee_structure.move_up', { name: d.name })} disabled={i === 0} onClick={() => move(i, -1)}><Ico d='caretUp' /></button>
              <button className="btn sm" aria-label={t('admin.fee_structure.move_down', { name: d.name })} disabled={i === draft.length - 1} onClick={() => move(i, 1)}><Ico d='caretDown' /></button>
              <button className="btn sm" aria-label={t('admin.fee_structure.remove', { name: d.name })} disabled={draft.length === 1} data-tip={t('admin.fee_structure.a_head_used_by_invoices')} onClick={() => setDraft(draft.filter((_, j) => j !== i))}><Ico d='close' /></button>
            </span>
          )}
        </div>
      ))}
      {may && (
        <div className="tgrow" style={{ marginTop: 12 }}>
          <button className="btn sm" disabled={draft.length >= 30} onClick={() => setDraft([...draft, { name: '', concession: false }])}>{t('admin.fee_structure.add_a_fee_head')}</button>
          <span className="grow"></span>
          {changed && <button className="btn" onClick={() => q.data && reset(q.data)}>{t('admin.fee_structure.discard_changes')}</button>}
          <button className="btn pri" disabled={!changed || save.isPending} onClick={() => save.mutate()}>{save.isPending ? t('admin.fee_structure.saving') : t('admin.fee_structure.save_fee_heads')}</button>
        </div>
      )}
    </Card>
  );
}

/** The rules Tangent set for the school's fees, so the office sees what families are charged and why. */
function Rules() {
  const { shell } = useShellChrome();
  const late = useSetting<number>('fees.lateFeePct', 0);
  const remind = useSetting<number>('fees.remindDaysBefore', 3);
  const fines = shell?.features.includes('fees.lateFines') ?? false;
  const reminders = shell?.features.includes('fees.reminders') ?? false;
  return (
    <Card title={t('admin.fee_structure.rules')}>
      <div className="kv"><span>{t('admin.fee_structure.late_fine')}</span><b>{fines && late > 0 ? t('admin.fee_structure.each_month_on_an_overdue', { late }) : t('admin.fee_structure.none')}</b></div>
      <div className="kv"><span>{t('admin.fee_structure.reminders')}</span><b>{reminders ? t('admin.fee_structure.before_the_due_date', { remind, p1: remind === 1 ? 'day' : 'days' }) : t('admin.fee_structure.not_sent')}</b></div>
      <p className="help" style={{ marginBottom: 0 }}>{t('admin.fee_structure.tangent_sets_these_for_your')}</p>
    </Card>
  );
}
