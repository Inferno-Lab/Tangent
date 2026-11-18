/* eslint-disable */
// Keep the markup and class names as designed.
import { Fragment, type CSSProperties } from "react";
import { Select, PageScope, ToastSlot, Segmented, Icon, EmptyNote } from "@tangent/web-ui";
import "./timetable.css";
import { t } from '@tangent/web-ui';

export function TimetableView({ v }: { v: any }) {
  return (
    <PageScope
      page="timetable"
      overlays={
        <ToastSlot toast={v.toast} />
      }
    >
      <main className="mn">
        <header className="hd rise">
          <div className="ht">
            <h1>{t('admin.timetable.view.timetable')}</h1>
            {v.tabs && <div style={{ margin: '8px 0' } as CSSProperties}>{v.tabs}</div>}
            <p>
              {t('admin.timetable.view.class')}{' '}{v.className} · {v.term} {t('admin.timetable.view.version')}{' '}{v.version},{" "}
              <span style={{ color: v.isDraft ? "var(--warn-i)" : "var(--ok-i)", fontWeight: "700" } as CSSProperties}>{v.isDraft ? "draft" : "published"}</span>
            </p>
          </div>
          <div className="ha">
          <button className="btn" onClick={v.openWeek}>{t('admin.timetable.view.a_teacher_s_or_room')}</button>
          <button className="btn" onClick={v.print}>{t('admin.timetable.view.print')}</button>
          {v.canPublish && (
          <button className="btn pri" onClick={v.publish}>
            <Icon name="send" />
            {t('admin.timetable.view.publish')}</button>
          )}
          </div>
        </header>
        <div className="wk rise" style={{ "--d": ".05s" } as CSSProperties}>
          <Select compact aria-label={t('admin.timetable.view.class')} value={String(Math.max(0, v.classes.findIndex((c: any) => c.on)))} onChange={(i) => v.classes[Number(i)]?.pick()} options={v.classes.map((c: any, i: number) => ({ value: String(i), label: c.n }))} />
          <Segmented label={t('admin.timetable.view.timetable_view')} value={String(v.views.findIndex((x: any) => x.on))} onChange={(i: string) => v.views[Number(i)].pick()} options={v.views.map((x: any, i: number) => ({ value: String(i), label: x.n }))} />
          <div className="wkp">
            <span>
              <Icon name="calendar" size={16} />
              {v.weekLabel}
            </span>
          </div>
          <span className="grow"></span>
          <span className={`chip ${v.clashChip ?? ""}`}>{v.clashText}</span>
          {v.draftChanges > 0 && (
            <span className="chip v">
              {t('admin.timetable.view.unpublished', { n: v.draftChanges })}
            </span>
          )}
          <span className="lgd" style={{ display: "flex", gap: "10px", flexWrap: "wrap" } as CSSProperties}>
            {v.legend.map((l: any, $i: number) => (
              <span key={$i} className={`chip ${l.k}`}>
                {l.n}
              </span>
            ))}
          </span>
        </div>
        <div className="bd" data-even="">
          <section className="tg rise" style={{ "--d": ".1s", ...v.tgStyle } as CSSProperties} aria-label={t('admin.timetable.view.week_grid')}>
            <div className="trow">
              <span></span>
              {v.days.map((d: any, $i: number) => (
                <Fragment key={$i}>
                  <div className={`dh ${d.today ?? ""}`}>
                    {d.n}
                    <b>{d.d}</b>
                  </div>
                </Fragment>
              ))}
            </div>
            {v.mode !== "list" &&
              v.rows.map((r: any, $i: number) => (
                <Fragment key={$i}>
                  <div className="trow">
                    <div className="tl">
                      {r.l}
                      <small>{r.t}</small>
                    </div>
                    {r.brk && (
                      <>
                        <div className="br">
                          <Icon name="breakTime" size={16} />
                          {r.name}
                        </div>
                      </>
                    )}
                    {r.per && (
                      <>
                        {r.cells.map((c: any, $i: number) => (
                          <Fragment key={$i}>
                            <button
                              className={`cl ${c.k ?? ""} ${c.sel ?? ""} ${c.bad ?? ""} ${c.now ?? ""}`}
                              style={{ "--d": `${c.d ?? ""}s`, "--pg": `${c.pg ?? ""}%` } as CSSProperties}
                              onClick={c.pick}
                              data-tip={c.tip}
                              aria-pressed={c.pressed}
                            >
                              {c.isBad && (
                                <>
                                  <span className="alert" aria-label={t('admin.timetable.view.clash')}>
                                    <Icon name="alert" size={14} />
                                  </span>
                                </>
                              )}
                              {c.isFixed && (
                                <>
                                  <span className="fixed">
                                    <Icon name="check" size={14} />
                                  </span>
                                </>
                              )}
                              <b>{c.n}</b>
                              <small>{c.t}</small>
                              <span className="rm">{c.r}</span>
                            </button>
                          </Fragment>
                        ))}
                      </>
                    )}
                  </div>
                </Fragment>
              ))}
            {v.mode === "list" && (
              <div className="lst" style={{ gridColumn: "1 / -1" } as CSSProperties}>
                {v.list.map((it: any, $i: number) => (
                  <button key={$i} className={`lrow ${it.k}`} onClick={it.pick}>
                    <span className="d">{it.day}</span>
                    <b>{it.n}</b>
                    <span>{it.t}</span>
                    <span className="num">{it.time}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          {v.dialog}
          <aside className="side">
            <section className="det" aria-live="polite" aria-label={t('admin.timetable.view.selected_period')}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" } as CSSProperties}>
                <span className={`sw1 chip ${v.sel.k ?? ""}`} style={{ padding: "0" } as CSSProperties}>
                  {v.sel.ab}
                </span>
                <div>
                  <div className="fd" style={{ fontSize: "22px", letterSpacing: "-.025em" } as CSSProperties}>
                    {v.sel.n}
                  </div>
                  <div className="help">
                    {v.sel.day} · {v.sel.time}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" } as CSSProperties}>
                {v.sel.t && <span className="chip">{v.sel.t}</span>}
                {v.sel.r && <span className="chip">{t('admin.timetable.view.room')}{' '}{v.sel.r}</span>}
                <span className="chip">{v.sel.len}</span>
              </div>
              {v.sel.bad && (
                <>
                  <div className="call" role="alert">
                    <Icon name="warning" />
                    <div>
                      <b>{t('admin.timetable.view.clash_with')}{' '}{v.sel.other}.</b> {v.sel.t} {t('admin.timetable.view.is_also_teaching')}{' '}{v.sel.other} {t('admin.timetable.view.at_this_time_pick_a')}</div>
                  </div>
                </>
              )}
              {v.sel.fixedNow && (
                <>
                  <div className="call ok">
                    <Icon name="check" />
                    <div>
                      <b>{t('admin.timetable.view.clash_fixed')}</b> {v.sel.t} {t('admin.timetable.view.covers_this_period_both_classes')}</div>
                  </div>
                </>
              )}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" } as CSSProperties}>
                {v.sel.bad && (
                  <>
                    {v.sel.suggest && (
                      <button className="btn pri sm" onClick={v.fix}>
                        <Icon name="bolt" />
                        {t('admin.timetable.view.ask')}{' '}{v.sel.suggest} {t('admin.timetable.view.to_cover')}</button>
                    )}
                    <button className="btn sm" onClick={v.change}>
                      {t('admin.timetable.view.choose_someone_else')}</button>
                  </>
                )}
                {v.sel.fine && (
                  <>
                    {v.canEdit && (
                      <button className="btn sm" onClick={v.change}>
                        {t('admin.timetable.view.change_teacher')}</button>
                    )}
                  </>
                )}
                {v.periodTools}
              </div>
            </section>
            <section className="card" aria-labelledby="load">
              <div className="ch">
                <h2 id="load" style={{ fontSize: "17px" } as CSSProperties}>
                  {t('admin.timetable.view.teacher_load')}</h2>
                <span className="chip">{t('admin.timetable.view.this_week')}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "16px", margin: "12px 0 6px" } as CSSProperties}>
                <svg className="ring" viewBox="0 0 84 84" aria-hidden="true">
                  <circle className="bg" cx="42" cy="42" r="36"></circle>
                  <circle className="fg" cx="42" cy="42" r="36" style={{ strokeDashoffset: v.ringOff, stroke: v.ringC } as CSSProperties}></circle>
                </svg>
                <div>
                  <div className="fd" style={{ fontSize: "28px", letterSpacing: "-.035em", lineHeight: "1" } as CSSProperties}>
                    {v.kLoad}
                    <span className="muted" style={{ font: "700 15px var(--fb)" } as CSSProperties}>
                      {" "}
                      / {v.loadMax}
                    </span>
                  </div>
                  <div className="help" style={{ marginTop: "4px" } as CSSProperties}>
                    {v.loadName ? t('admin.timetable.view.periods', { loadName: v.loadName }) : t('admin.timetable.view.pick_a_lesson_to_see')}
                  </div>
                </div>
              </div>
              <div className="lscroll" data-even-scroll="" style={{ maxHeight: "232px" } as CSSProperties}>
              {v.loads.map((l: any, $i: number) => (
                <Fragment key={$i}>
                  <div className="lr" data-tip={t('admin.timetable.view.periods_this_week', { n: l.n, v: l.v })}>
                    <span className="av" style={{ width: "32px", height: "32px", fontSize: "11px", background: l.bg, color: l.fg, boxShadow: "none" } as CSSProperties}>
                      {l.ini}
                    </span>
                    <div style={{ minWidth: "0", width: "92px" } as CSSProperties}>
                      <b>{l.n}</b>
                      <small>{l.s}</small>
                    </div>
                    <div className="lb">
                      <i className={l.hot} style={{ width: `${l.p ?? ""}%` } as CSSProperties}></i>
                    </div>
                    <span className="num" style={{ font: "700 12px var(--fb)", width: "28px", textAlign: 'end' } as CSSProperties}>
                      {l.v}
                    </span>
                  </div>
                </Fragment>
              ))}
              </div>
            </section>
            <section className="card" aria-labelledby="unp">
              <div className="ch">
                <h2 id="unp" style={{ fontSize: "17px" } as CSSProperties}>
                  {t('admin.timetable.view.not_placed_yet')}</h2>
                {v.unplaced.length > 0 && <span className="chip a">{v.unplaced.length}</span>}
              </div>
              <div className="lscroll" data-even-scroll="" style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px", maxHeight: "176px" } as CSSProperties}>
                {v.unplaced.length === 0 && <EmptyNote icon="checkCircle" title={t('admin.timetable.view.everything_has_a_place')} body={t('admin.timetable.view.every_period_this_class_needs')} />}
                {v.unplaced.map((u: any, $i: number) => (
                  <div className="un" key={$i}>
                    <Icon name="drag" size={16} style={{ color: "var(--ink3)" }} />
                    {u.name} · {t('admin.timetable.view.n_periods', { n: u.missing })}
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </PageScope>
  );
}
