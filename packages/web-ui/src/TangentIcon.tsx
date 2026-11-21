import { t } from './i18n';
import { MARK_PATH, MARK_VIEW_BOX } from './tangent-mark';
// The Tangent app icon (design/logo/tangent-app-icon.svg): the graduation fold on its ink tile, for places that show Tangent itself.
// Its colours are the logo's own, never the school's.

export function TangentIcon({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={t('ui.tangent_icon.tangent')} style={{ display: 'block', flex: 'none' }}>
      <rect width="64" height="64" rx="14" fill="#111111" />
      <svg x="9.6" y="12.27" width="44.8" height="39.46" viewBox={MARK_VIEW_BOX}>
        <path fill="#FFFFFF" fillRule="evenodd" d={MARK_PATH} />
      </svg>
    </svg>
  );
}
