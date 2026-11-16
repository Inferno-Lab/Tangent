import type { CSSProperties } from 'react';
import { GLYPH, IC, ICON_SIZE, UI } from './icons';

export type PageIcon = keyof typeof IC;
export type IconName = PageIcon | keyof typeof UI | keyof typeof GLYPH;

/**
 * Every icon in the admin and the console (Tangent Hue, design/hue/icon-map.mjs): one meaning, one icon. A page icon is
 * filled when its page is the one open (`on`); everyday icons turn bold at 16 px and under; small symbols are always bold.
 */
// Icons that point along the line of reading: mirrored when the page reads right to left (blocks.css .ic-flip).
const POINTING = new Set<IconName>(['next', 'back', 'caretLeft', 'caretRight', 'upRight', 'downRight', 'undo', 'redo', 'send', 'signOut', 'open', 'moving', 'sidebar']);

export function Icon({ name, size = ICON_SIZE.m, on, className, style }: { name: IconName; size?: number; on?: boolean; className?: string; style?: CSSProperties }) {
  const d = name in GLYPH ? GLYPH[name as keyof typeof GLYPH] : name in UI ? UI[name as keyof typeof UI][size <= ICON_SIZE.s ? 'b' : 'r'] : IC[name as PageIcon][on ? 'f' : 'r'];
  return (
    <svg className={`ic${POINTING.has(name) ? ' ic-flip' : ''} ${className ?? ''}`} viewBox="0 0 256 256" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false" style={style}>
      <path d={d} />
    </svg>
  );
}
