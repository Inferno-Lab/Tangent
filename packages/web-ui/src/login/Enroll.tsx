import { useState } from 'react';
import { Qr } from '../Qr';
import { Icon } from '../Icon';
import { t } from '../i18n';

/**
 * Adding an authenticator at the first sign-in: a QR code to scan, and the same key to type for an app that cannot scan
 * (in groups of four, with a copy button), and a link that opens the app on this phone.
 */
export function Enroll({ secret, uri }: { secret: string; uri: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => void navigator.clipboard?.writeText(secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined);
  return (
    <div className="enr">
      <Qr value={uri} size={148} label={t('ui.login.enroll.qr_label')} />
      <div className="enr-t">
        <b>{t('ui.login.enroll.scan')}</b>
        <small>{t('ui.login.enroll.or_type')}</small>
        <div className="enr-k">
          <code>{secret.match(/.{1,4}/g)?.join(' ')}</code>
          <button type="button" className="mini" onClick={copy} aria-label={t('ui.login.enroll.copy')} data-tip={copied ? t('ui.login.enroll.copied') : t('ui.login.enroll.copy')}><Icon name={copied ? 'check' : 'copy'} size={16} /></button>
        </div>
        <a href={uri}>{t('ui.login.view.open_in_the_authenticator_app')}</a>
      </div>
    </div>
  );
}
