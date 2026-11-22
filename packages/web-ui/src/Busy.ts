/** What a mutation needs to say which row it is working on (TanStack Query's useMutation result). */
interface Running { isPending: boolean; variables?: unknown }

/**
 * Whether [m] is working on this [row] (its id, or the row itself): what it was given is the row, or names it in one of its
 * fields (`{ id: r.id, … }`, `{ row: r, … }`). Only that row's buttons wait; the rest of the list stays usable.
 */
export function busyFor(m: Running, row: unknown): boolean {
  if (!m.isPending) return false;
  const v = m.variables;
  if (v === row) return true;
  return typeof v === 'object' && v !== null && Object.values(v).includes(row);
}

// The button that started each change in flight: it shows a spinner (aria-busy, blocks.css) and takes no second click.
let pressed: { el: HTMLElement; at: number } | null = null;
const working = new Map<unknown, HTMLElement>();
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('button,.btn');
    pressed = el ? { el, at: performance.now() } : null;
  }, true);
}

/** A change starts (MutationCache onMutate): the button just pressed shows it is working. */
export function markBusy(mutation: unknown): void {
  // Only a change the press started (within a moment of it), not one a timer or a page load started.
  if (!pressed || performance.now() - pressed.at > 400 || !pressed.el.isConnected) return;
  pressed.el.setAttribute('aria-busy', 'true');
  working.set(mutation, pressed.el);
  pressed = null;
}

/** The change is done (MutationCache onSettled): its button is back. */
export function clearBusy(mutation: unknown): void {
  working.get(mutation)?.removeAttribute('aria-busy');
  working.delete(mutation);
}
