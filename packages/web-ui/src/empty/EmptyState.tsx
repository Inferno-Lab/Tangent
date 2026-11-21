import { useEffect, useLayoutEffect, useRef } from 'react';
import { SPECTRUM_COLOURS, spectrumTokens } from '@tangent/contracts';
import { SCENE_CSS, SCENES } from './scenes';
import { t } from '../i18n';

export type EmptyScene = keyof typeof SCENES;

// Inside the scene's own style scope the kit's text colours are the page's ink (on the web --t1..--t3 are motion timings).
// The page's spectrum classes cannot reach into the shadow root, so the scene carries its own (else every block is the brand
// colour). The boards' grey panels behind the words are dropped: the words sit on the card itself.
const SPECTRUM = SPECTRUM_COLOURS.map((c) => {
  const decl = (m: 'light' | 'dark') => Object.entries(spectrumTokens(c, m)).map(([k, v]) => `--${k}:${v}`).join(';');
  return `.sp-${c}{${decl('light')}}.dark .sp-${c}{${decl('dark')}}`;
}).join('');
// The scene card in the Nest look: a hairline and the old 28px corners; it rises and lifts from the host (empty.css).
const CARD = '.es{border-radius:28px;box-shadow:inset 0 0 0 1px var(--line)}';
const HOST = SPECTRUM + CARD + '[style*="background:var(--s2)"]:not(.ring){background:none!important}' + ':host{display:block;--t1:var(--ink);--t2:var(--ink2);--t3:var(--ink3);--shadow:var(--sh2)}.hue{background:none;font-family:var(--fb)}.nolink .lk,.noact .acts .btn{display:none!important}' +
  // The close button sits on the words' own box (the popup when the scene floats one), never out on the far card corner.
  '.float{position:relative}.x{position:absolute;top:10px;inset-inline-end:10px;z-index:2;width:34px;height:34px;border-radius:999px;border:0;display:grid;place-items:center;cursor:pointer;background:var(--s2);color:var(--ink2);transition:background var(--t1),color var(--t1)}.x:hover{background:var(--line);color:var(--ink)}.x:focus-visible{outline:2px solid var(--brand);outline-offset:2px}.float:has(.x) .ew{padding-inline-end:28px}';

/**
 * A page with nothing in it yet (Tangent Hue, design/hue/EMPTY-STATES.md): the approved composition for that page, its words
 * and one main button, with the scene moving in a 10 s loop (still under reduced motion). Show it only when the data is truly
 * empty: loading, errors and a filter with no match keep their own states. Without `onAction` (no permission) the button is
 * left out; `label` renames it where this product's next step differs from the board's.
 */
export function EmptyState({ scene, onAction, onLink, label, onClose }: { scene: EmptyScene; onAction?: () => void; onLink?: () => void; label?: string; onClose?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const act = useRef({ onAction, onLink, onClose });
  act.current = { onAction, onLink, onClose };
  useLayoutEffect(() => {
    const el = host.current!;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${SCENE_CSS}${HOST}</style><div class="hue${el.closest('.dark') ? ' dark' : ''}${onLink ? '' : ' nolink'}${onAction ? '' : ' noact'}">${SCENES[scene]}</div>`;
    const btn = root.querySelector('.acts .btn');
    if (label && btn) btn.textContent = label;
    if (onClose) {
      const x = document.createElement('button');
      x.className = 'x';
      x.setAttribute('aria-label', t('ui.empty_state.hide'));
      x.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      (root.querySelector('.float') ?? root.querySelector('.es'))?.append(x);
    }
  }, [scene, !onLink, !onAction, !onClose, label]);
  useEffect(() => {
    const root = host.current!.shadowRoot!;
    const click = (e: Event) => {
      const t = (e.target as Element).closest('.btn, .lk, .x');
      if (!t) return;
      e.preventDefault();
      if (t.classList.contains('x')) act.current.onClose?.();
      else if (t.classList.contains('lk')) act.current.onLink?.(); else act.current.onAction?.();
    };
    root.addEventListener('click', click);
    return () => root.removeEventListener('click', click);
  }, []);
  // A welcome that can be put away (`onClose`): the caller remembers it, so it does not come back on every visit.
  return <div ref={host} className="es-host" />;
}
