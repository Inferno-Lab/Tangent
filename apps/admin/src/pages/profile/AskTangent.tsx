import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, useShake, t } from '@tangent/web-ui';
import { useApp } from '../../app/context';
import { AreaField } from '../../app/kit';

/** "Ask Tangent to change this": the request lands in the console's Requests, and Tangent's answer shows here. */
export function AskTangent({ area, onClose, onDone }: { area: string; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [err, setErr] = useState('');
  const shake = useShake();
  const mine = useQuery({ queryKey: ['change-requests'], queryFn: app.api.changeRequests.list });
  const send = useMutation({
    mutationFn: () => app.api.changeRequests.create({ area, message: message.trim() }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['change-requests'] }); onDone(); },
    onError: (e) => { setErr((e as Error).message); shake.hit(); },
  });
  const go = () => { if (message.trim().length < 5) { setErr(t('admin.ask_tangent.say_what_you_would_like')); shake.hit(); } else send.mutate(); };
  return (
    <Dialog title={t('admin.ask_tangent.ask_tangent_to_change_this')} tag={{ text: area, tone: 'v' }} onClose={onClose} width={560} shake={shake.cls}>
      <div className="stack">
        <AreaField label={t('admin.ask_tangent.what_would_you_like_changed')} value={message} onChange={(v) => { setMessage(v); setErr(''); }} error={err} maxLength={1000} rows={4} placeholder={t('admin.ask_tangent.for_example_put_fees_in')} />
        <div className="tgrow" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>{t('admin.ask_tangent.cancel')}</button>
          <button className="btn pri" disabled={send.isPending} onClick={go}>{send.isPending ? t('admin.ask_tangent.sending') : t('admin.ask_tangent.send_to_tangent')}</button>
        </div>
        {(mine.data ?? []).length > 0 && (
          <div>
            <div className="lbl" style={{ marginBottom: 6 }}>{t('admin.ask_tangent.your_requests')}</div>
            {(mine.data ?? []).slice(0, 5).map((r) => (
              <div key={r.id} className="kv" style={{ alignItems: 'flex-start' }}>
                <span style={{ minWidth: 0 }}><b style={{ font: '700 13px var(--fb)' }}>{r.area}</b> · {r.message}{r.answer && <small style={{ display: 'block', color: 'var(--ink3)' }}>{t('admin.ask_tangent.tangent')}{' '}{r.answer}</small>}</span>
                <b><span className={`chip ${r.status === 'open' ? 'a' : r.status === 'done' ? 'g' : 'c'}`}>{r.status === 'open' ? t('admin.ask_tangent.waiting') : r.status === 'done' ? t('admin.ask_tangent.done') : t('admin.ask_tangent.declined')}</span></b>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
