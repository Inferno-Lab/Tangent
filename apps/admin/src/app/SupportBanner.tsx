import { useEffect, useState } from 'react';
import { useTheme, Icon, t as tr } from '@tangent/web-ui';

/** Shown for the whole of a support session: a red frame, who is looking, the time left, and a way out. The API refuses every change. */
export function SupportBanner({ school, until, onEnd }: { school: string; until: number; onEnd: () => void }) {
  const theme = useTheme();
  const [left, setLeft] = useState(() => Math.max(0, Math.round((until - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((until - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [until]);
  useEffect(() => { if (left === 0) onEnd(); }, [left, onEnd]);
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return (
    <div className={`nest ${theme.cls}`} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 90 }}>
      <div className="glow" aria-hidden="true"></div>
      <div className="sbar" role="status" style={{ pointerEvents: 'auto' }}>
        <Icon name="shield" size={16} />
        {tr('admin.support_banner.tangent_support_in')}{' '}{school} {tr('admin.support_banner.read_only')}<span className="c num">{mm}:{ss} {tr('admin.support_banner.left')}</span>
        <button onClick={onEnd}>{tr('admin.support_banner.end_session')}</button>
      </div>
    </div>
  );
}
