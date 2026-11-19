// Sets the theme before the first paint, so a dark page never flashes light. A file of its own, not an inline script:
// the server's Content-Security-Policy runs only the site's own scripts.
try {
  var t = localStorage.getItem('tangent.theme');
  document.documentElement.dataset.theme = t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (document.documentElement.dataset.theme === 'dark') document.documentElement.style.background = '#07060B';
} catch (e) {}
