import { useState } from 'react';
import { Icon, Illustration, t } from '@tangent/web-ui';

/** No school in the address: ask for it, as an empty card with the noticeboard. */
export function SchoolPicker() {
  const [slug, setSlug] = useState('');
  const ok = /^[a-z][a-z0-9-]{2,30}[a-z0-9]$/.test(slug.trim().toLowerCase());
  return (
    <div className="nest" style={{ minHeight: '100dvh', padding: 16, display: 'grid', placeItems: 'center' }}>
      <form style={{ maxWidth: 440, width: '100%' }} onSubmit={(e) => { e.preventDefault(); if (ok) window.location.href = `/s/${slug.trim().toLowerCase()}`; }}>
        <article className="es">
          <div className="eh"><b>{t('admin.school_picker.sign_in')}</b></div>
          <div className="eb">
            <div className="art"><Illustration scene="noticeboard" /></div>
            <h3>{t('admin.school_picker.which_school')}</h3>
            <p>{t('admin.school_picker.type_your_school_s_tangent')}</p>
            <label className="in3" style={{ marginTop: 10 }}>
              <Icon name="home" size={18} />
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="greenfield" aria-label={t('admin.school_picker.school_address')} autoFocus autoCapitalize="none" spellCheck={false} />
            </label>
            <div className="es-act"><button className="btn pri" disabled={!ok}>{t('admin.school_picker.open_my_school')}<Icon name="next" /></button></div>
          </div>
        </article>
      </form>
    </div>
  );
}
