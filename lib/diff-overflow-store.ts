/**
 * Page-wide diff line-overflow preference (scroll vs. wrap).
 *
 * Mirrors `diff-style-store`: one in-memory value, persisted to
 * `localStorage` so the choice carries between PRs, with cross-tab sync via
 * the `storage` event. The toolbar writes; mounted diffs subscribe.
 *
 * Persisted under `ghdiffs:diffOverflow`. Defaults to `scroll` because the
 * `@pierre/diffs` virtualizer interacts badly with `wrap` on the GitHub PR
 * /files page (the document grows mid-mount and the page scrolls to the
 * bottom). Wrap is opt-in.
 */
export type DiffOverflow = 'scroll' | 'wrap';

const STORAGE_KEY = 'ghdiffs:diffOverflow';
const DEFAULT_OVERFLOW: DiffOverflow = 'scroll';

type Listener = () => void;

function readInitial(): DiffOverflow {
  if (typeof localStorage === 'undefined') return DEFAULT_OVERFLOW;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'wrap' || v === 'scroll' ? v : DEFAULT_OVERFLOW;
  } catch {
    return DEFAULT_OVERFLOW;
  }
}

let current: DiffOverflow = readInitial();
const listeners = new Set<Listener>();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next: DiffOverflow = e.newValue === 'wrap' ? 'wrap' : 'scroll';
    if (next === current) return;
    current = next;
    for (const l of listeners) l();
  });
}

export function getDiffOverflow(): DiffOverflow {
  return current;
}

export function setDiffOverflow(next: DiffOverflow): void {
  if (next !== 'scroll' && next !== 'wrap') return;
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore — pref still applies in-memory for this session.
  }
  for (const l of listeners) l();
}

export function subscribeDiffOverflow(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
