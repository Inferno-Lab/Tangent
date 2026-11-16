import { configureLanguages, startLanguage } from '@tangent/web-ui/i18n';
import en from './i18n/en.json';

// The person's language is in before any page loads, so every label (constants too) is drawn in it (web-ui i18n).
configureLanguages({ en, surface: 'console', api: (import.meta.env.VITE_API_URL as string | undefined) ?? '' });
void startLanguage().then(() => import('./boot'));
