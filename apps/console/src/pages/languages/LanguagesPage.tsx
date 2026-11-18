import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { I18N_SURFACES, I18N_SURFACE_LABELS, languageLabel, type I18nSurface, type TranslationRow } from '@tangent/contracts';
import { AreaField, Checkbox, FilePick, Field, Segmented, Select, EmptyNote } from '@tangent/web-ui';
import { Card, Page, Tiles, useToast } from '../../app/Page';
import { useApp } from '../../app/context';
import { t } from '@tangent/web-ui';

type Filter = 'missing' | 'review' | 'all';
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

/**
 * Languages (docs/one-shot-plan.md §3.5.9): how far each language is on each part of Tangent, every text beside its English,
 * machine drafts from the Hub's translation connection, and a person's approval. A saved text reaches every page within a
 * minute; one that loses a {value} is refused, so a translation can never break a page.
 */
export function LanguagesPage() {
  const app = useApp();
  const qc = useQueryClient();
  const { toast, say } = useToast();
  const [lang, setLang] = useState('hi');
  const [surface, setSurface] = useState<I18nSurface>('admin');
  const [filter, setFilter] = useState<Filter>('missing');
  const [q, setQ] = useState('');
  const canWrite = app.can('languages.write');
  const summary = useQuery({ queryKey: ['languages'], queryFn: app.api.languages.summary });
  const rows = useQuery({ queryKey: ['languages', lang, surface, filter, q], queryFn: () => app.api.languages.rows(lang, surface, filter, q) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['languages'] });
  const draft = useMutation({
    mutationFn: () => app.api.languages.draft(lang, { surface, limit: 200 }),
    onSuccess: (r) => { refresh(); say(t('console.languages_page.drafted_for_review_still_to', { drafted: r.drafted, p1: r.skipped ? t('console.languages_page.n_left_for_a_person', { n: r.skipped }) : '', left: r.left })); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const bring = useMutation({
    mutationFn: (csv: string) => app.api.languages.importCsv(lang, surface, csv),
    onSuccess: (r) => { refresh(); say(t('console.languages_page.texts_saved', { saved: r.saved, p1: r.refused.length ? t('console.languages_page.n_refused', { n: r.refused.length }) : '' })); },
    onError: (e) => say((e as Error).message, 'bad'),
  });
  const download = () => void app.api.languages.exportCsv(lang, surface).then(({ csv }) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `tangent-${surface}-${lang}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, (e: Error) => say(e.message, 'bad'));
  const mine = summary.data?.find((l) => l.code === lang);
  const total = mine ? I18N_SURFACES.reduce((n, s) => n + mine.surfaces[s].total, 0) : 0;
  const done = mine ? I18N_SURFACES.reduce((n, s) => n + mine.surfaces[s].translated, 0) : 0;
  const approved = mine ? I18N_SURFACES.reduce((n, s) => n + mine.surfaces[s].reviewed, 0) : 0;
  return (
    <Page title={t('console.languages_page.languages')} sub={t('console.languages_page.every_word_of_tangent_in')} toast={toast}
      loading={summary.isLoading} error={summary.isError ? { message: (summary.error as Error).message, retry: () => void summary.refetch() } : null}
      filters={<Select compact aria-label={t('console.languages_page.language')} value={lang} onChange={setLang} options={(summary.data ?? []).map((l) => ({ value: l.code, label: languageLabel(l.code) }))} />}
      actions={canWrite && <>
        <FilePick accept=".csv,.txt" onPick={(f) => void f.text().then((csv) => bring.mutate(csv))} disabled={bring.isPending}>{t('console.languages_page.bring_in_a_sheet')}</FilePick>
        <button className="btn pri" disabled={draft.isPending} onClick={() => draft.mutate()}>{draft.isPending ? t('console.languages_page.drafting') : t('console.languages_page.draft_the_missing')}</button>
      </>}>
      <Tiles items={[
        { label: t('console.languages_page.translated'), value: `${pct(done, total)}%`, note: t('console.languages_page.of_texts', { done, total }), tone: 'v' },
        { label: t('console.languages_page.approved_by_a_person'), value: `${pct(approved, total)}%`, note: t('console.languages_page.approved', { approved }), tone: 'g' },
        { label: t('console.languages_page.still_in_english'), value: total - done, note: t('console.languages_page.shown_in_english_until_translated'), tone: total - done ? 'a' : 'i' },
      ]} />
      <Card title={t('console.languages_page.by_part_of_tangent')}>
        {I18N_SURFACES.map((s) => {
          const c = mine?.surfaces[s];
          return (
            <div key={s} className="kv">
              <span>{I18N_SURFACE_LABELS[s]}</span>
              <b>{c ? t('console.languages_page.translated_approved', { pct: pct(c.translated, c.total), pct1: pct(c.reviewed, c.total) }) : '–'}</b>
            </div>
          );
        })}
      </Card>
      <Card title={t('console.languages_page.texts')} chip={<button className="btn sm" onClick={download}>{t('console.languages_page.download_the_sheet')}</button>}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Segmented label={t('console.languages_page.part_of_tangent')} value={surface} onChange={setSurface} options={I18N_SURFACES.map((s) => ({ value: s, label: I18N_SURFACE_LABELS[s] }))} />
          <Segmented label={t('console.languages_page.which_texts')} value={filter} onChange={setFilter} options={[{ value: 'missing', label: t('console.languages_page.missing') }, { value: 'review', label: t('console.languages_page.to_approve') }, { value: 'all', label: t('console.languages_page.all') }]} />
          <div style={{ flex: '1 1 220px', maxWidth: 320 }}><Field label={t('console.languages_page.find')} value={q} onChange={setQ} placeholder={t('console.languages_page.a_word_in_english_or')} /></div>
        </div>
        {rows.data && !rows.data.length
          ? <EmptyNote icon="check" title={t('console.languages_page.nothing_here')} body={filter === 'missing' ? t('console.languages_page.every_text_of_this_part') : t('console.languages_page.no_text_matches')} />
          : (rows.data ?? []).map((r) => <TextRow key={r.key} lang={lang} surface={surface} row={r} canWrite={canWrite} onSaved={refresh} onError={(m) => say(m, 'bad')} />)}
        {(rows.data?.length ?? 0) >= 500 && <div className="help">{t('console.languages_page.the_first_500_are_shown')}</div>}
      </Card>
    </Page>
  );
}

/** One text: its English, the translation to edit, and whether a person approved it. */
function TextRow({ lang, surface, row, canWrite, onSaved, onError }: { lang: string; surface: I18nSurface; row: TranslationRow; canWrite: boolean; onSaved: () => void; onError: (m: string) => void }) {
  const app = useApp();
  const [text, setText] = useState(row.text);
  const [reviewed, setReviewed] = useState(row.reviewed);
  const save = useMutation({ mutationFn: () => app.api.languages.put(lang, surface, { key: row.key, text, reviewed }), onSuccess: onSaved, onError: (e) => onError((e as Error).message) });
  const changed = text !== row.text || reviewed !== row.reviewed;
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '14px 0', display: 'grid', gap: 8 }}>
      <div className="help" style={{ margin: 0 }}><b>{row.english}</b> · {row.source === 'machine' ? t('console.languages_page.machine_draft') : row.source === 'file' ? 'shipped' : row.source === 'person' ? t('console.languages_page.by', { p0: row.updatedBy ?? 'a person' }) : 'missing'}</div>
      <AreaField label={languageLabel(lang)} value={text} onChange={setText} rows={2} disabled={!canWrite} />
      {canWrite && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Checkbox checked={reviewed} onChange={setReviewed} label={t('console.languages_page.approved_2')} disabled={!text.trim()} />
          <button className="btn sm" disabled={!changed || save.isPending} onClick={() => save.mutate()}>{t('console.languages_page.save')}</button>
        </div>
      )}
    </div>
  );
}
