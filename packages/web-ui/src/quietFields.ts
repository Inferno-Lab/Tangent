// Password managers and mail extensions put their own icons into any field they take for a sign-in or an email address
// (a search box whose hint says "email" got one). Every field that does not say what it autofills is marked as not
// theirs, once, as it appears; the sign-in fields keep their autocomplete and so their managers.
const IGNORE = { 'data-1p-ignore': 'true', 'data-lpignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other' };

const FIELDS = 'input:not([autocomplete]), textarea:not([autocomplete])';

function quiet(root: Element | Document): void {
  const own = root instanceof Element && root.matches(FIELDS) ? [root as HTMLInputElement] : [];
  for (const el of [...own, ...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(FIELDS)]) {
    if (el.type === 'password' || el.type === 'hidden') continue;
    el.setAttribute('autocomplete', 'off');
    for (const [k, v] of Object.entries(IGNORE)) el.setAttribute(k, v);
  }
}

/** Starts marking the page's fields; call once at boot. */
export function quietFields(): void {
  quiet(document);
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (n instanceof Element) quiet(n);
  }).observe(document.body, { childList: true, subtree: true });
}
