// The layout scans, each run inside a loaded page (page.evaluate): tools/check-pages.mjs runs any of them on the same
// load as the audit; the scan-*.mjs commands still run one on its own. Each returns a list of findings.

/** --scans gaps */
export const gaps = () => {
  const out = [];
  const nm = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 60 && r.height > 24 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const boxed = (el) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const hasBg = bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg);
    const hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    return (hasBg || hasBorder) && parseFloat(cs.borderTopLeftRadius) >= 12;
  };
  const main = document.querySelector('.mn');
  if (!main) return ['no .mn'];
  const mr = main.getBoundingClientRect();
  const mcs = getComputedStyle(main);
  const padB = parseFloat(mcs.paddingBottom);
  const padR = parseFloat(mcs.paddingRight);
  let bottom = 0;
  const boxes = [...main.querySelectorAll('*')].filter((e) => vis(e) && boxed(e) && !e.closest('.popm,.sxp,.scrim,.mod,.drw,.toast,.save,.bulk'));
  for (const el of boxes) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  const hole = Math.round(mr.bottom - padB - bottom);
  if (hole > 60) out.push(`hole under the last card: ${hole}px`);
  // side by side with unequal heights
  const parents = new Set([main, ...main.querySelectorAll('*')]);
  for (const p of parents) {
    const kids = [...p.children].filter((k) => vis(k) && boxed(k));
    if (kids.length < 2) continue;
    const rows = new Map();
    for (const k of kids) { const t = Math.round(k.getBoundingClientRect().top / 8); rows.set(t, [...(rows.get(t) ?? []), k]); }
    for (const row of rows.values()) {
      if (row.length < 2) continue;
      const hs = row.map((k) => Math.round(k.getBoundingClientRect().height));
      const lefts = new Set(row.map((k) => Math.round(k.getBoundingClientRect().left / 10)));
      if (lefts.size < 2) continue;
      const mx = Math.max(...hs), mn = Math.min(...hs);
      if (mx - mn > 90) out.push(`side by side, unequal: ${row.map((k, i) => `${nm(k)}=${hs[i]}`).join(' | ')}`);
    }
  }
  // columns side by side whose last cards end at different heights
  const bottomOf = (el) => {
    if (boxed(el)) return el.getBoundingClientRect().bottom;
    let b = null;
    for (const d of el.querySelectorAll('*')) {
      if (!vis(d) || !boxed(d)) continue;
      // a card inside a list that scrolls only reaches as far down as the list's own window
      let bottom = d.getBoundingClientRect().bottom;
      for (let a = d.parentElement; a && a !== el; a = a.parentElement) if (/auto|scroll|hidden/.test(getComputedStyle(a).overflowY)) bottom = Math.min(bottom, a.getBoundingClientRect().bottom);
      b = Math.max(b ?? 0, bottom);
    }
    return b;
  };
  for (const p of [main, ...main.querySelectorAll('*')]) {
    const cs = getComputedStyle(p);
    if (!(cs.display.includes('grid') || (cs.display.includes('flex') && !cs.flexDirection.startsWith('column')))) continue;
    // boards (admissions, exams) are lanes of cards, whose lengths are the data
    if (p.closest('header,.hd,.popm,.sxp,.mod,.drw,.ch,.tgrow,.adm,.exb')) continue;
    // a navigation rail (settings sections, wizard steps) is a menu, not a column of content
    const kids = [...p.children].filter((k) => vis(k) && k.getBoundingClientRect().height > 60 && k.tagName !== 'NAV' && getComputedStyle(k).position !== 'sticky');
    const rows = new Map();
    for (const k of kids) { const t = Math.round(k.getBoundingClientRect().top / 12); rows.set(t, [...(rows.get(t) ?? []), k]); }
    for (const row of rows.values()) {
      const cols = row.map((k) => [k, bottomOf(k)]).filter(([, b]) => b != null);
      if (cols.length < 2 || new Set(cols.map(([k]) => Math.round(k.getBoundingClientRect().left / 10))).size < 2) continue;
      const bs = cols.map(([, b]) => b);
      const d = Math.round(Math.max(...bs) - Math.min(...bs));
      if (d > 16) out.push(`columns end unevenly by ${d}px: ${cols.map(([k, b]) => `${nm(k)}@${Math.round(b)}`).join(' | ')}`);
    }
  }
  // blank inside a card
  for (const el of boxes) {
    const r = el.getBoundingClientRect();
    if (r.height < 260 || r.width < 240) continue;
    const cs = getComputedStyle(el);
    let content = r.top + parseFloat(cs.paddingTop);
    for (const d of el.querySelectorAll('*')) {
      if (!vis(d) && !(d.getBoundingClientRect().height > 0)) continue;
      const dcs = getComputedStyle(d);
      if (dcs.display === 'none' || dcs.position === 'absolute' || dcs.position === 'fixed') continue;
      const b = d.getBoundingClientRect().bottom;
      if (b <= r.bottom + 1) content = Math.max(content, b);
    }
    const blank = Math.round(r.bottom - parseFloat(cs.paddingBottom) - content);
    if (blank > 150) out.push(`blank inside ${nm(el)} (${Math.round(r.width)}x${Math.round(r.height)}): ${blank}px`);
  }
  // stops short of the right edge
  const right = mr.right - padR;
  for (const k of [...main.children].filter((e) => vis(e))) {
    const r = k.getBoundingClientRect();
    if (r.width > 300 && right - r.right > 120 && k.tagName !== 'HEADER' && !k.matches('.seg')) out.push(`stops short of the right edge: ${nm(k)} by ${Math.round(right - r.right)}px`);
  }
  return [...new Set(out)];
};

/** --scans fit */
export const fit = () => {
  const out = [];
  const nm = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''} "${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)}"`;
  const shown = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const lineHeight = (cs) => (cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.25 : parseFloat(cs.lineHeight));
  // 1. a short control whose text wraps
  const sel = 'button,a.btn,.fp,.chip,.st,.tr,.wkp span,.sx,.mini,.ibtn,.kbd,.av,.lbl,.cb,[role=tab],.lgd span,.hws';
  for (const el of document.querySelectorAll(sel)) {
    if (!shown(el) || el.closest('.dock')) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.height > 64 || el.matches('.rlb,.nv')) continue;
    if (el.closest('.morph:not(.open)')) continue;
    // any single piece of text inside the control that breaks onto a second line
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let wrapped = null;
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(t);
      const rs = [...rg.getClientRects()].filter((x) => x.width > 1);
      const lines = new Set(rs.map((x) => Math.round(x.top / 5))).size;
      if (lines > 1 && getComputedStyle(t.parentElement).whiteSpace !== 'pre-wrap' && r.height <= 64 && parseFloat(cs.borderTopLeftRadius) >= 16) wrapped = t;
      for (const x of rs) {
        if (x.right > r.right + 2 || x.left < r.left - 2 || x.bottom > r.bottom + 2 || x.top < r.top - 2) { out.push(`contents outside the box: ${nm(el)} (${Math.round(r.width)}x${Math.round(r.height)})`); break; }
      }
    }
    if (wrapped) out.push(`text wraps inside a short control: ${nm(el)} (${Math.round(r.width)}x${Math.round(r.height)})`);
  }
  // 3. a segmented control's knob must sit exactly on the chosen tab
  for (const seg of document.querySelectorAll('.seg')) {
    if (!shown(seg)) continue;
    const kn = seg.querySelector('.kn');
    const on = seg.querySelector('button.on,button[aria-selected=true]');
    if (!kn || !on) continue;
    const k = kn.getBoundingClientRect(), b = on.getBoundingClientRect();
    if (Math.abs(k.left - b.left) > 2 || Math.abs(k.width - b.width) > 2) out.push(`knob off the tab: ${nm(seg)} knob ${Math.round(k.left)}+${Math.round(k.width)} tab ${Math.round(b.left)}+${Math.round(b.width)}`);
    const s = seg.getBoundingClientRect();
    if (seg.scrollWidth > seg.clientWidth + 2 && getComputedStyle(seg).overflowX === 'visible') out.push(`tabs wider than their track: ${nm(seg)}`);
    for (const t of seg.querySelectorAll('button')) { const r = t.getBoundingClientRect(); if (r.right > s.right + 1 && getComputedStyle(seg).overflowX === 'visible') { out.push(`tab outside its track: ${nm(t)}`); break; } }
  }
  // 4. words that only appear when a value is missing
  const tw = document.createTreeWalker((window.__scanRoot ?? document.querySelector('.mn') ?? document.body), NodeFilter.SHOW_TEXT);
  // The Languages page shows catalogue texts as written, and some start with a separator.
  for (let t = location.pathname.endsWith('/languages') ? null : tw.nextNode(); t; t = tw.nextNode()) {
    const s = t.parentElement.textContent.trim();
    if (/undefined|NaN|\[object |null/.test(s) || /^·\s/.test(s)) out.push(`a missing value shows as text: "${s.slice(0, 40)}" in ${nm(t.parentElement)}`);
  }
  return [...new Set(out)].slice(0, 30);
};

/** --scans cutoff */
export const cutoff = () => {
  const out = [];
  const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || el.closest('svg') && el.tagName !== 'svg') continue;
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`text cut: ${name(el)} "${txt}"`);
    else if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2 && el.children.length && cs.textOverflow !== 'ellipsis') out.push(`hides sideways: ${name(el)} ${el.scrollWidth}>${el.clientWidth} "${txt}"`);
    if ((cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 2 && r.height > 20) out.push(`hides below: ${name(el)} ${el.scrollHeight}>${el.clientHeight} "${txt}"`);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2 && r.height > 60) {
      const hiddenBar = cs.scrollbarWidth === 'none' || getComputedStyle(el, '::-webkit-scrollbar').display === 'none';
      if (hiddenBar) out.push(`scrolls with no bar: ${name(el)}`);
    }
    if (el.matches('input,textarea') && el.placeholder && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`input text cut: ${name(el)} "${el.placeholder}"`);
    if (el.matches('input[placeholder]') && !el.value) {
      const c = document.createElement('canvas').getContext('2d'); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      if (c.measureText(el.placeholder).width > el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) out.push(`placeholder cut: ${name(el)} "${el.placeholder}"`);
    }
  }
  return [...new Set(out)].slice(0, 25);
};

/** --scans scroll */
export const scroll = async () => {
  const out = [];
  const nm = (el) => `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).slice(0, 2).join('.')}`;
  const boxes = [...document.querySelectorAll('.mn *')].filter((e) => { const cs = getComputedStyle(e); return /auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 20 && e.clientHeight > 80; });
  for (const box of boxes) {
    const times = [];
    let last = performance.now();
    const steps = 40;
    for (let i = 1; i <= steps; i++) {
      box.scrollTop = ((box.scrollHeight - box.clientHeight) * i) / steps;
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now(); times.push(now - last); last = now;
    }
    times.sort((x, y) => x - y);
    const p90 = times[Math.floor(times.length * 0.9)], worst = times[times.length - 1];
    if (p90 > 25 || worst > 60) out.push(`slow scroll in ${nm(box)}: p90 ${p90.toFixed(0)} ms, worst ${worst.toFixed(0)} ms`);
    const th = box.querySelector('.grd.th');
    if (th && th.offsetParent) {
      const b = box.getBoundingClientRect(), r = th.getBoundingClientRect();
      if (r.top < b.top - 1 || r.bottom > b.bottom + 1) out.push(`column titles scroll away in ${nm(box)}`);
    }
    box.scrollTop = 0;
  }
  return out;
};

/** --scans tight */
export const tight = () => {
  const out = [];
  const nm = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.height > 0 && r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.position !== 'absolute' && cs.position !== 'fixed'; };
  const boxed = (el) => {
    if (el.matches('table,.tbl,.fld,.inp,input,textarea,.sel,.ch')) return true;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    return (!!bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopLeftRadius) >= 8);
  };
  const texty = (el) => !boxed(el) && !el.querySelector('input,textarea,table,button,.fld,.inp') && (el.textContent ?? '').trim().length > 2 && /^(H[1-6]|P|SMALL|LABEL|SPAN|B|DIV)$/.test(el.tagName);
  const main = (window.__scanRoot ?? document.querySelector('.mn') ?? document.body);
  for (const p of [main, ...main.querySelectorAll('*')]) {
    const cs = getComputedStyle(p);
    const column = cs.display === 'block' || (cs.display.includes('flex') && cs.flexDirection.startsWith('column')) || cs.display.includes('grid');
    if (!column || p.closest('.popm,.sxp,.toast,.rw,button,a,.chip,label')) continue;
    const kids = [...p.children].filter(shown);
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1], b = kids[i];
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      // one below the other, overlapping sideways
      if (rb.top < ra.bottom - 2 || rb.left >= ra.right || rb.right <= ra.left) continue;
      const gap = Math.round(rb.top - ra.bottom);
      if (gap >= 6) continue;
      if ((texty(a) && boxed(b)) || (boxed(a) && texty(b))) out.push(`${gap}px between ${nm(a)} “${(a.textContent ?? '').trim().slice(0, 30)}” and ${nm(b)}`);
    }
  }
  return [...new Set(out)];
};

/** Rows that repeat (the same parts in each, one under the other) whose parts do not start on the same line across rows. */
export const align = () => {
  const out = [];
  const nm = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; };
  const sig = (el) => [...el.children].filter(shown).map(nm).join('|');
  const main = (window.__scanRoot ?? document.querySelector('.mn') ?? document.body);
  for (const p of [main, ...main.querySelectorAll('*')]) {
    if (p.closest('.popm,.sxp,.toast,.tgrow,svg')) continue;
    const rows = [...p.children].filter((k) => shown(k) && getComputedStyle(k).display.includes('flex') && !getComputedStyle(k).flexDirection.startsWith('column') && getComputedStyle(k).flexWrap !== 'wrap-reverse');
    const groups = new Map();
    for (const r of rows) { const s = sig(r); if (s.split('|').length >= 2) groups.set(s, [...(groups.get(s) ?? []), r]); }
    for (const [s, g] of groups) {
      if (g.length < 2) continue;
      // Only rows stacked one under the other, the same width, and laid out on one line each.
      const w = Math.round(g[0].getBoundingClientRect().width);
      const x0 = Math.round(g[0].getBoundingClientRect().left);
      const same = g.filter((r) => Math.abs(r.getBoundingClientRect().width - w) < 2 && Math.abs(r.getBoundingClientRect().left - x0) < 2 && new Set([...r.children].filter(shown).map((c) => Math.round(c.getBoundingClientRect().top / 6))).size === 1);
      if (same.length < 2) continue;
      // A part lines up when its left edges, right edges or centres do (a value set to the end of a row lines up on the right).
      const boxes = same.map((r) => [...r.children].filter(shown).map((c) => c.getBoundingClientRect()));
      for (let i = 1; i < boxes[0].length; i++) {
        const sp = (f) => { const xs = boxes.map((b) => f(b[i])); return Math.max(...xs) - Math.min(...xs); };
        const spread = Math.min(sp((b) => b.left), sp((b) => b.right), sp((b) => b.left + b.width / 2));
        if (spread > 3) { out.push(`${nm(p)}: part ${i + 1} of ${same.length} rows (${s.split('|')[i]}) starts ${Math.round(spread)}px apart`); break; }
      }
    }
  }
  return [...new Set(out)];
};

/** A list that runs on: more than 25 rows straight down the page, not inside a box that scrolls and with no pages. */
export const long = () => {
  const out = [];
  const nm = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const main = (window.__scanRoot ?? document.querySelector('.mn') ?? document.body);
  const scrolls = (el) => { for (let a = el; a && a !== main; a = a.parentElement) { const cs = getComputedStyle(a); if (/auto|scroll/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 4) return true; } return false; };
  for (const p of [main, ...main.querySelectorAll('*')]) {
    if (p.closest('.popm,.sxp,.toast,svg,select')) continue;
    const kids = [...p.children].filter((k) => k.getBoundingClientRect().height > 0);
    if (kids.length <= 25) continue;
    const byTag = new Map();
    for (const k of kids) byTag.set(nm(k), (byTag.get(nm(k)) ?? 0) + 1);
    const [tag, count] = [...byTag].sort((a, b) => b[1] - a[1])[0];
    if (count <= 25) continue;
    // rows one under the other (a wrapping grid of chips or tiles is a different thing)
    const tops = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top)));
    if (tops.size <= 25) continue;
    if (p.getBoundingClientRect().height < 900 || scrolls(p)) continue;
    out.push(`${count} × ${tag} in ${nm(p)}, ${Math.round(p.getBoundingClientRect().height)}px tall, no scroll or pages`);
  }
  return out;
};

/** A bare line that says a list is empty, outside the empty-state parts. */
export const empty = () => {
  const out = [];
  const main = (window.__scanRoot ?? document.querySelector('.mn') ?? document.body);
  const parts = '.es-host,.en,.es,[data-empty]';
  for (const el of main.querySelectorAll('p,div,small,span,td,li')) {
    if (el.children.length || el.closest(parts) || el.closest('.popm,.sxp,.toast,option,button,label')) continue;
    const t = (el.textContent ?? '').trim();
    if (t.length < 4 || t.length > 160) continue;
    if (/^(no|nothing|nobody|none|there (are|is) no|not any)\b/i.test(t) && el.getBoundingClientRect().height > 0) out.push(`“${t.slice(0, 70)}”`);
  }
  return [...new Set(out)];
};
