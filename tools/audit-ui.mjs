#!/usr/bin/env node
// The full page check: every admin and console page at four widths, light and dark (CI runs this). It is
// tools/check-pages.mjs --full; that file has the options (--only, --rtl, --sizes, --shots, --changed…).
if (!process.argv.includes('--full') && !process.argv.includes('--quick')) process.argv.push('--full');
await import('./check-pages.mjs');
