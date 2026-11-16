import { DEFAULT_BRAND, SPECTRUM_COLOURS } from '@tangent/contracts';
import { useState } from 'react';
import { Checkbox, ColourField, DateField, Dialog, EmptyCard, ErrorLine, Field, FilePick, MenuButton, NumberField, PageScope, Presence, Segmented, ColourPicker, SelectField, TimeField, ToastSlot, tintFor, useToast, useShake, EmptyState, IC, Icon, UI, type PageIcon, t as tr } from '@tangent/web-ui';
import { useShellChrome } from '../app/Layout';

// Surfaces and text are the fixed Nest neutrals; the school's seed (Tangent Hue) gives the accents, and status has its own colours.
const SWATCHES: [string, string][] = [[tr('admin.design_page.ink_main_action_dark_cards'), '--deep'], [tr('admin.design_page.bright_on_dark_cards'), '--bright'], [tr('admin.design_page.brand_accent'), '--brand'], [tr('admin.design_page.brand_soft'), '--brand-soft'], [tr('admin.design_page.canvas'), '--bd'], [tr('admin.design_page.ground'), '--bg'], [tr('admin.design_page.card'), '--s1'], [tr('admin.design_page.well'), '--s2'], [tr('admin.design_page.text'), '--ink'], [tr('admin.design_page.secondary_text'), '--ink2'], [tr('admin.design_page.captions'), '--ink3'], [tr('admin.design_page.good'), '--ok'], [tr('admin.design_page.watch'), '--warn'], [tr('admin.design_page.act'), '--bad'], [tr('admin.design_page.note'), '--info']];
const CHIPS = ['', 'v', 'c', 'a', 'g'] as const;

/** A living style guide (Tangent Hue's parts in the Nest look) built from the real components, so it can never drift from what the pages use. Open it at /design. */
export function DesignPage() {
  const chrome = useShellChrome();
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState(0);
  const [dlg, setDlg] = useState(false);
  const { toast, say } = useToast();
  const [name, setName] = useState('');
  const [day, setDay] = useState('2026-11-12');
  const [time, setTime] = useState('08:30');
  const [count, setCount] = useState('40');
  const [colour, setColour] = useState(DEFAULT_BRAND);
  const [tick, setTick] = useState(true);
  const [menu, setMenu] = useState(false);
  const [file, setFile] = useState('');
  const shake = useShake();
  return (
    <PageScope page="design" overlays={<><ToastSlot toast={toast} /><Presence>{dlg && <Dialog title={tr('admin.design_page.erase_this_draft')} tag={{ text: tr('admin.design_page.cannot_be_undone'), tone: 'c' }} onClose={() => setDlg(false)} width={440}><p>{tr('admin.design_page.the_draft_and_everything_typed')}</p><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}><button className="btn" onClick={() => setDlg(false)}>{tr('admin.design_page.keep_it')}</button><button className="btn dngf" onClick={() => setDlg(false)}>{tr('admin.design_page.erase')}</button></div></Dialog>}</Presence></>}>
      <main className="mn">
        <header className="hd rise"><div><h1>{tr('admin.design_page.design_system')}</h1><p>{tr('admin.design_page.the_pieces_every_admin_and')}</p></div><span className="grow"></span><button className="btn" onClick={chrome.openSearch}>{tr('admin.design_page.search')}</button></header>

        <Section title={tr('admin.design_page.colour')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
            {SWATCHES.map(([n, v]) => (
              <div key={v}><div style={{ height: 64, borderRadius: 16, background: `var(${v})`, boxShadow: 'inset 0 0 0 1px var(--line)' }} /><b style={{ font: '700 13px var(--fb)', display: 'block', marginTop: 6 }}>{n}</b><small style={{ color: 'var(--ink3)', font: '600 12px var(--fb)' }}>{v}</small></div>
            ))}
          </div>
        </Section>

        <Section title={tr('admin.design_page.spectrum')}>
          <p className="help" style={{ marginTop: 0 }}>{tr('admin.design_page.twelve_fixed_hues_that_name')}</p>
          <div className="tgrow">{SPECTRUM_COLOURS.map((c) => <span key={c} className={`chip sp-${c}`} style={{ background: 'var(--cs)', color: 'var(--ci)' }}>{c}</span>)}</div>
        </Section>

        <Section title={tr('admin.design_page.type')}>
          <div className="fd" style={{ font: '700 40px/44px var(--fd)', letterSpacing: '-.035em' }}>{tr('admin.design_page.bricolage_grotesque_for_headings_and')}</div>
          <p style={{ font: '400 15px/22px var(--fb)', color: 'var(--ink2)', maxWidth: 640 }}>{tr('admin.design_page.manrope_carries_every_label_row')}</p>
          <div className="num" style={{ font: '700 30px var(--fd)' }}>1,498 · 18,400 · 94.2%</div>
        </Section>

        <Section title={tr('admin.design_page.icons')}>
          <p className="help" style={{ marginTop: 0 }}>{tr('admin.design_page.one_family_phosphor_one_meaning')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            {(Object.keys(IC) as PageIcon[]).map((k) => <div key={k} className="tgrow" style={{ gap: 8 }}><Icon name={k} /><Icon name={k} on /><small className="help">{k}</small></div>)}
          </div>
          <div className="tgrow" style={{ marginTop: 12 }}>{(Object.keys(UI) as (keyof typeof UI)[]).map((k) => <span key={k} data-tip={k}><Icon name={k} /></span>)}</div>
        </Section>

        <Section title={tr('admin.design_page.buttons_and_chips')}>
          <div className="tgrow">
            <button className="btn pri">{tr('admin.design_page.primary')}</button><button className="btn">{tr('admin.design_page.plain')}</button><button className="btn ghost">{tr('admin.design_page.ghost')}</button><button className="btn dng">{tr('admin.design_page.danger')}</button><button className="btn" disabled>{tr('admin.design_page.disabled')}</button>
            <button className="btn pri sm">{tr('admin.design_page.small')}</button><button className="btn"><span className="spin" aria-hidden="true"></span>{tr('admin.design_page.working')}</button>
          </div>
          <div className="tgrow" style={{ marginTop: 16 }}>{CHIPS.map((c) => <span key={c} className={`chip ${c}`}>{c || 'plain'}</span>)}</div>
        </Section>

        <Section title={tr('admin.design_page.inputs_errors_and_switches')}>
          <div className="two" style={{ maxWidth: 720 }}>
            <div className={shake.cls}><Field label={tr('admin.design_page.school_name')} value={name} onChange={setName} placeholder={tr('admin.design_page.northfield_school')} error={name === 'x' ? tr('admin.design_page.enter_the_school_s_full') : undefined} hint={tr('admin.design_page.press_the_button_to_see')} icon="admissions" /></div>
            <SelectField label={tr('admin.design_page.board')} value="National curriculum" onChange={() => undefined} options={[tr('admin.design_page.national_curriculum'), tr('admin.design_page.international'), tr('admin.design_page.state')].map((v) => ({ value: v, label: v }))} />
          </div>
          <div className="tgrow" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => { setName('x'); shake.hit(); }}>{tr('admin.design_page.make_it_vibrate')}</button>
            <button className={`sw ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={tr('admin.design_page.example_switch')} onClick={() => setOn(!on)}></button>
            <Segmented label={tr('admin.design_page.view')} value={String(seg)} onChange={(v) => setSeg(Number(v))} options={[tr('admin.design_page.week'), tr('admin.design_page.day'), tr('admin.design_page.list')].map((t, i) => ({ value: String(i), label: t }))} />
          </div>
          <div style={{ marginTop: 12 }}><ErrorLine>{tr('admin.design_page.this_is_what_an_error')}</ErrorLine></div>
        </Section>

        <Section title={tr('admin.design_page.fields')}>
          <p className="help" style={{ marginTop: 0 }}>{tr('admin.design_page.no_browser_widgets_every_field')}</p>
          <div className="two" style={{ maxWidth: 720 }}>
            <DateField label={tr('admin.design_page.due_on')} value={day} onChange={setDay} hint={tr('admin.design_page.type_12_nov_or_pick')} />
            <TimeField label={tr('admin.design_page.starts_at')} value={time} onChange={setTime} hint={tr('admin.design_page.type_8_47_or_pick')} />
            <NumberField label={tr('admin.design_page.marks_out_of')} value={count} onChange={setCount} min={1} max={100} />
            <DateField label={tr('admin.design_page.ends_on')} value="" onChange={() => undefined} error={tr('admin.design_page.pick_a_day_after_it')} />
          </div>
          <div className="tgrow" style={{ marginTop: 12, alignItems: 'center' }}>
            <Checkbox checked={tick} onChange={setTick} label={tr('admin.design_page.send_a_copy_to_parents')} />
            <ColourField label={tr('admin.design_page.brand_colour')} value={colour} onChange={setColour} />
            <FilePick onPick={(f) => setFile(f.name)}>{file || tr('admin.design_page.choose_a_file')}</FilePick>
            <MenuButton label={tr('admin.design_page.new')} icon='plus' primary open={menu} onOpenChange={setMenu} menuLabel={tr('admin.design_page.add_something_new')}>
              <button role="menuitem" onClick={() => setMenu(false)}>{tr('admin.design_page.add_student')}<small>N S</small></button>
              <button role="menuitem" onClick={() => setMenu(false)}>{tr('admin.design_page.post_a_notice')}<small>N N</small></button>
            </MenuButton>
          </div>
          <div style={{ marginTop: 12 }}><ColourPicker label={tr('admin.design_page.any_colour')} value={colour} onChange={setColour} /></div>
        </Section>

        <Section title={tr('admin.design_page.tiles_and_bars')}>
          <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {(['t-v', 't-a', 't-g', 't-i', 't-l', 't-p'] as const).map((t) => <div key={t} className={`tile ${t}`} style={{ minHeight: 120 }}><b className="fd" style={{ fontSize: 22 }}>{t}</b><div style={{ font: '600 13px var(--fb)', opacity: .7 }}>{tr('admin.design_page.a_tile')}</div></div>)}
          </div>
          <div style={{ display: 'grid', gap: 10, marginTop: 16, maxWidth: 520 }}>
            {[78, 52, 31].map((w) => <div key={w} style={{ height: 22, borderRadius: 10, background: 'var(--s2)', overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${w}%`, borderRadius: 10, background: 'var(--brand)' }} /></div>)}
          </div>
          <div className="tgrow" style={{ marginTop: 16 }}>{[tr('admin.design_page.maya_torres'), tr('admin.design_page.leo_martin'), tr('admin.design_page.ada_novak'), tr('admin.design_page.sam_okafor')].map((n) => { const t = tintFor(n); return <span key={n} className="av" style={{ background: t.bg, color: t.fg, width: 44, height: 44, display: "grid", placeItems: "center" }}>{n.split(' ').map((w) => w[0]).join('')}</span>; })}</div>
        </Section>

        <Section title={tr('admin.design_page.overlays')}>
          <p className="help" style={{ marginTop: 0 }}>{tr('admin.design_page.popups_grow_from_their_button')}</p>
          <div className="tgrow"><button className="btn" onClick={() => setDlg(true)}>{tr('admin.design_page.open_a_dialog')}</button><button className="btn" onClick={() => say(tr('admin.design_page.saved_the_app_updates_within'))}>{tr('admin.design_page.show_a_toast')}</button><button className="btn" onClick={() => say(tr('admin.design_page.couldn_t_save_check_the'), 'bad')}>{tr('admin.design_page.show_an_error')}</button></div>
        </Section>

        <Section title={tr('admin.design_page.empty_pages')}>
          <EmptyState scene="students" onAction={() => say(tr('admin.design_page.this_is_where_the_import'))} onLink={() => say(tr('admin.design_page.this_is_where_add_one'))} />
        </Section>

        <Section title={tr('admin.design_page.errors_closed_doors_and_no')}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            <EmptyCard title={tr('admin.design_page.students')} chip={{ text: tr('admin.design_page.0_students'), tone: 'v' }} icon="people" heading={tr('admin.design_page.no_students_yet')} body={tr('admin.design_page.add_the_first_student_or')} actions={<button className="btn pri">{tr('admin.design_page.import_from_excel')}</button>} />
            <EmptyCard error title={tr('admin.design_page.fees')} chip={{ text: tr('admin.design_page.couldn_t_load'), tone: 'c' }} icon="warning" heading={tr('admin.design_page.that_didn_t_load')} body={tr('admin.design_page.the_server_did_not_answer')} actions={<button className="btn pri">{tr('admin.design_page.try_again')}</button>} />
          </div>
        </Section>
      </main>
    </PageScope>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card rise" style={{ marginBottom: 16 }}><div className="ch"><h2>{title}</h2></div><div style={{ marginTop: 12 }}>{children}</div></section>;
}
