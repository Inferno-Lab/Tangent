/* eslint-disable */
// Keep the markup and class names as designed.
import { Fragment, type CSSProperties } from "react";
import { Roll, PageScope, Presence, Segmented, Panel, Icon, EmptyState, EmptyNote } from "@tangent/web-ui";
import "./students.css";
import { t as tr } from '@tangent/web-ui';

export function StudentsView({ v }: { v: any }) {
  return (
    <PageScope page="students">
      <main className="mn">
        <header className="hd rise">
          <div className="ht">
            <h1>{v.heading}</h1>
            <p>{v.subtitle}</p>
          </div>
          <div className="ha">
          <button className="btn" onClick={v.openImport}>
            <Icon name="upload" />
            {tr('admin.students.view.import')}</button>
          <button className="btn" onClick={v.exportAll}>
            <Icon name="download" />
            {tr('admin.students.view.export')}</button>
          <button className="btn pri" onClick={v.openAdd}>
            <Icon name="plus" />
            {tr('admin.students.view.add_student')}</button>
          </div>
        </header>
        {v.tabs && <div className="pbar rise">{v.tabs}</div>}
        <div className="fbar rise" style={{ "--d": ".05s" } as CSSProperties}>
          <Segmented label={tr('admin.students.view.students_view')} value={String(v.views.findIndex((x: any) => x.on))} onChange={(i: string) => v.views[Number(i)].pick()} options={v.views.map((x: any, i: number) => ({ value: String(i), label: x.n, count: x.c, countTone: x.cc }))} />
          <span className="grow"></span>
          {v.pills}
        </div>
        <section className="strip4 rise" style={{ "--d": ".1s" } as CSSProperties} aria-label={tr('admin.students.view.summary')}>
          <div className="sm">
            <span className="l">{tr('admin.students.view.students_in_view')}</span>
            <div className="v">{v.sum.inView}</div>
            <div className="s">{tr('admin.students.view.of')}{' '}{v.sum.total}</div>
          </div>
          {v.has.attendance && (
          <div className="sm">
            <span className="l">{tr('admin.students.view.present')}{' '}{v.sum.dayWord}</span>
            <div className="v">
              <Roll digits={v.sum.presD} />
              <em>/{v.sum.marked}</em>
            </div>
            <div className="s">
              <span className="tr">{v.sum.unmarked}</span>{tr('admin.students.view.not_marked_yet')}</div>
          </div>
          )}
          {v.has.fees && (
          <div className="sm">
            <span className="l">{tr('admin.students.view.fees_overdue')}</span>
            <div className="v">
              {v.sum.overdue}
            </div>
            <div className="s">
              <span className="tr dn">{v.sum.families}</span>{tr('admin.students.view.past_the_due_date')}</div>
          </div>
          )}
          {v.has.attendance && (
          <div className="sm">
            <span className="l">{tr('admin.students.view.average_attendance')}</span>
            <div className="v">
              {v.sum.avgNone ? "–" : v.sum.avg}
              {!v.sum.avgNone && <em>%</em>}
            </div>
            <div className="s">
              <span className={`tr ${v.sum.deltaCls}`}>{v.sum.delta}</span>{tr('admin.students.view.vs_the_12_days_before')}</div>
          </div>
          )}
        </section>
        <section className="tcard rise" style={{ "--d": ".15s" } as CSSProperties} aria-label={tr('admin.students.view.students_table')}>
          <div className="tcap">
            <h2>{v.title}</h2>
            <div className="srch" style={{ minWidth: "280px", height: "38px" } as CSSProperties}>
              <Icon name="search" />
              <input
                value={v.q}
                onChange={v.onQ}
                placeholder={tr('admin.students.view.name_or_admission_no')}
                aria-label={tr('admin.students.view.search_students')}
                style={
                  {
                    border: "0",
                    outline: "0",
                    background: "none",
                    font: "600 13px var(--fb)",
                    color: "var(--ink)",
                    flex: "1",
                    minWidth: "0",
                  } as CSSProperties
                }
              />
            </div>
          </div>
          {v.hasRows && (
            <>
              <div className="scroll-x">
              <div className="gmin">
              <div className="grd th" style={{ "--cols": v.cols } as CSSProperties} role="row">
                <button className={`cb ${v.allOn ?? ""}`} role="checkbox" aria-checked={v.allSel} aria-label={tr('admin.students.view.select_all')} onClick={v.toggleAll}>
                  <Icon name="check" />
                </button>
                <button type="button" className="sortb" aria-sort={v.dir === "asc" ? "ascending" : "descending"} data-tip={tr('admin.students.view.sort_by_name')} onClick={v.flipSort} style={{ border: "0", background: "none", font: "inherit", color: "inherit", cursor: "pointer", padding: "0" } as CSSProperties}>
                  {tr('admin.students.view.student')}<Icon name={v.dir === "asc" ? 'caretDown' : 'caretUp'} />
                </button>
                <span>{tr('admin.students.view.class')}</span>
                <span>{tr('admin.students.view.guardian')}</span>
                {v.has.attendance && <span>{tr('admin.students.view.last_10_days')}</span>}
                {v.has.fees && <span>{tr('admin.students.view.fees')}</span>}
              </div>
              {v.rows.map((r: any, $i: number) => (
                <Fragment key={$i}>
                  <div
                    className={`grd rw ${r.sel ?? ""}`}
                    style={{ "--cols": v.cols } as CSSProperties}
                    role="row"
                    onClick={r.open}
                    tabIndex={0}
                    onKeyDown={r.key}
                  >
                    <button className={`cb ${r.cbOn ?? ""}`} role="checkbox" aria-checked={r.checked} aria-label={tr('admin.students.view.select', { p0: r.n ?? "" })} onClick={r.toggle}>
                      <Icon name="check" />
                    </button>
                    <div className="who">
                      <span className="av" style={{ background: r.bg, color: r.fg, boxShadow: "none" } as CSSProperties}>
                        {r.ini}
                      </span>
                      <div style={{ minWidth: "0" } as CSSProperties}>
                        <b>{r.n}</b>
                        <small>
                          {tr('admin.students.view.adm')}{' '}{r.adm} · {r.house}
                        </small>
                      </div>
                    </div>
                    <span className="cls">
                      {r.cls} · {r.roll}
                    </span>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--ink2)" } as CSSProperties}>{r.g}</span>
                    {v.has.attendance && <span className="tk" aria-label={tr('admin.students.view.percent_present', { p0: r.att ?? "" })}>
                      {r.tk.map((t: any, $i: number) => (
                        <Fragment key={$i}>
                          <i className={t.c} style={{ "--k": t.k } as CSSProperties}></i>
                        </Fragment>
                      ))}
                    </span>}
                    {v.has.fees && <span className={`fs ${r.fcls ?? ""} ${r.pp ?? ""}`}>
                      <Icon name={r.fic} size={14} />
                      {r.fees}
                    </span>}
                  </div>
                </Fragment>
              ))}
              </div>
              </div>
              <div className="tfoot">
                <span>{tr('admin.students.view.showing')}{' '}{v.range}</span>
                <span style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" } as CSSProperties}>
                  {v.perPage}
                  <button className="btn sm" disabled={v.page <= 1} onClick={v.prev}>
                    {tr('admin.students.view.previous')}</button>
                  <button className="btn sm" disabled={!v.hasNext} onClick={v.next}>
                    {tr('admin.students.view.next')}</button>
                </span>
              </div>
            </>
          )}
          {v.noRows && v.emptySchool && <EmptyState scene="students" onAction={v.empty.act} onLink={v.empty.act2} />}
          {v.noRows && !v.emptySchool && (
            <>
              <div className="empt">
                <span className="emic"><Icon name="search" size={24} /></span>
                <b className="fd" style={{ fontSize: "22px", letterSpacing: "-.025em" } as CSSProperties}>
                  {v.empty.title}
                </b>
                <span className="m2" style={{ font: "400 14px var(--fb)" } as CSSProperties}>
                  {v.empty.body}
                </span>
                <div style={{ display: "flex", gap: "10px", marginTop: "10px", flexWrap: "wrap", justifyContent: "center" } as CSSProperties}>
                  <button className="btn pri sm" onClick={v.empty.act}>
                    {v.empty.actLabel}
                  </button>
                  {v.empty.act2 && (
                    <button className="btn sm" onClick={v.empty.act2}>
                      {v.empty.act2Label}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </main>
      <div className={`bulk ${v.bulkOn ?? ""}`} role="region" aria-label={tr('admin.students.view.bulk_actions')}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 12px 0 16px", font: "700 13px var(--fb)" } as CSSProperties}>
          <span className="chip v" style={{ height: "26px" } as CSSProperties}>
            {v.count}
          </span>
          {tr('admin.students.view.selected')}</span>
        <button className="bk" onClick={v.bulkMessage}>
          <Icon name="messages" />
          {tr('admin.students.view.message')}</button>
        <button className="bk" onClick={v.bulkInvite}>
          <Icon name="mobile" />
          {tr('admin.students.view.invite_to_app')}</button>
        {v.has.fees && (
        <button className="bk" onClick={v.bulkFee}>
          <Icon name="fees" />
          {tr('admin.students.view.assign_fee')}</button>
        )}
        <button className="bk" onClick={v.bulkExport}>
          <Icon name="download" />
          {tr('admin.students.view.export')}</button>
        <button className="bk" onClick={v.clear} aria-label={tr('admin.students.view.clear_selection')}>
          <Icon name="close" />
        </button>
      </div>
      <Presence>{v.dialog}</Presence>
      <Presence>{v.drOn && (
          <Panel label={tr('admin.students.view.student_profile')} onClose={v.close}>
            <div className="dh">
              <div className="dtop">
                <span className="dav" style={{ background: v.d.bg, color: v.d.fg } as CSSProperties}>
                  {v.d.ini}
                </span>
                <div>
                  <div className="fd" style={{ fontSize: "28px", letterSpacing: "-.03em", lineHeight: "1.1" } as CSSProperties}>
                    {v.d.n}
                  </div>
                  <div style={{ font: "600 13px var(--fb)", color: "var(--ink3)", marginTop: "4px" } as CSSProperties}>
                    {tr('admin.students.view.adm')}{' '}{v.d.adm} {tr('admin.students.view.class_2')}{' '}{v.d.cls} {tr('admin.students.view.roll')}{' '}{v.d.roll}
                  </div>
                </div>
                <button className="xbtn" aria-label={tr('admin.students.view.close')} onClick={v.close}>
                  <Icon name="close" size={20} />
                </button>
              </div>
              {v.left && (
                <div className="tgrow" style={{ marginBottom: "8px" } as CSSProperties}>
                  <span className="chip a">{v.left.line}</span>
                  {v.left.back && <button className="btn sm" onClick={v.left.back}>{tr('admin.students.view.bring_back_on_the_roll')}</button>}
                </div>
              )}
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" } as CSSProperties}>
                <span className={`fs ${v.d.fcls ?? ""}`}>{v.d.fees}</span>
                {v.d.house && <span className="chip">{v.d.house} {tr('admin.students.view.house')}</span>}
                {v.d.route && <span className="chip v">{v.d.route}</span>}
              </div>
            </div>
            <div className="db">
              <div className="facts">
                {v.d.show.att && <div className="fc t-v" style={{ "--d": ".05s" } as CSSProperties}>
                  <span>{tr('admin.students.view.attendance_this_term')}</span>
                  <b>{v.d.att}%</b>
                </div>}
                {v.d.show.exam && <div className="fc t-a" style={{ "--d": ".1s" } as CSSProperties}>
                  <span>{v.d.examName}</span>
                  <b>{v.d.exam}</b>
                </div>}
                {v.d.show.hw && <div className="fc t-g" style={{ "--d": ".15s" } as CSSProperties}>
                  <span>{tr('admin.students.view.homework_on_time')}</span>
                  <b>{v.d.homework}</b>
                </div>}
                {v.d.show.lib && <div className="fc t-l" style={{ "--d": ".2s" } as CSSProperties}>
                  <span>{tr('admin.students.view.library_books_out')}</span>
                  <b>{v.d.library}</b>
                </div>}
              </div>
              <div>
                <h3>{v.d.rollTitle}</h3>
                <div className="roll24" aria-label={v.d.rollAria}>
                  {v.heat.map((h: any, $i: number) => (
                    <Fragment key={$i}>
                      <i className={h.c} style={{ "--d": `${h.d ?? ""}s` } as CSSProperties}></i>
                    </Fragment>
                  ))}
                </div>
              </div>
              <div>
                <h3 style={{ display: "flex", alignItems: "center", gap: "8px" } as CSSProperties}>{tr('admin.students.view.guardians')}{v.may.edit && <button className="btn sm" style={{ marginInlineStart: "auto" } as CSSProperties} onClick={v.editGuardians}>{tr('admin.students.view.change')}</button>}</h3>
                {v.guardians.map((g: any, $i: number) => (
                <div className="g" key={$i} style={{ marginTop: $i ? "8px" : "0" } as CSSProperties}>
                  <span className="av" style={{ background: "var(--s1)", color: "var(--ink2)", boxShadow: "none" } as CSSProperties}>
                    {g.ini}
                  </span>
                  <div style={{ flex: "1", minWidth: "0" } as CSSProperties}>
                    <b style={{ font: "700 14px var(--fb)" } as CSSProperties}>{g.n}</b>
                    <div style={{ font: "600 12px var(--fb)", color: "var(--ink3)" } as CSSProperties}>{g.line}</div>
                  </div>
                  <span className="num" style={{ font: "700 12px var(--fb)", color: "var(--ink2)" } as CSSProperties}>
                    {g.phone || "–"}
                  </span>
                  {g.primary && (
                  <button className="rev" onClick={v.reveal}>
                    {v.rlab}
                  </button>
                  )}
                </div>
                ))}
              </div>
              {v.files}
              <div>
                <h3>{tr('admin.students.view.activity')}</h3>
                {v.d.activity.length === 0 && <EmptyNote icon="pulse" title={tr('admin.students.view.nothing_yet')} body={tr('admin.students.view.payments_homework_and_attendance_notes')} />}
                {v.d.activity.map((e: any, $i: number) => (
                  <div className="ev" key={$i}>
                    <i style={{ background: e.color } as CSSProperties}></i>
                    <div>
                      {e.label}
                      <small>{e.sub}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", padding: "16px 24px 24px", borderTop: "1px solid var(--line)" } as CSSProperties}>
              <button className="btn pri" style={{ flex: "1" } as CSSProperties} onClick={v.messageOne}>
                {tr('admin.students.view.message_guardians')}</button>
              {v.may.edit && (
                <button className="btn" onClick={v.edit}>
                  {tr('admin.students.view.edit')}</button>
              )}
              {v.canCollect && (
                <button className="btn" onClick={v.collect}>
                  {tr('admin.students.view.collect_fee')}</button>
              )}
              {v.may.leave && (
                <button className="btn" data-tip={tr('admin.students.view.record_that_this_student_left')} onClick={v.leave}>
                  {tr('admin.students.view.leaving')}</button>
              )}
            </div>
          </Panel>
      )}</Presence>
    </PageScope>
  );
}
