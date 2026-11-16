import { addCatalogue, startLanguage } from '@tangent/web-ui/i18n';
import en from './i18n/en.json';

// The person's language is in before any page loads, so every label (constants too) is drawn in it (web-ui i18n).
addCatalogue(en, (lang) => import(`./i18n/${lang}.json`).then((m: { default: Record<string, string> }) => m.default));
void startLanguage().then(() => import('./boot'));
