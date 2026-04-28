/**
 * Page-wide diff-style preference (unified vs. split).
 *
 * One store instance lives in the main-world content script. The toolbar
 * writes to it; every mounted `<MultiFileDiff>` / `<PatchDiff>` subscribes
 * and re-renders when it changes. Persisted to `localStorage` (page origin)
 * so the choice carries between PRs.
 *
 * Persisted under `ghdiffs:diffStyle`. The `storage` event lets us pick up
 * changes made in another github.com tab too.
 */
export type DiffStyle = 'unified' | 'split';

const STORAGE_KEY = 'ghdiffs:diffStyle';
const DEFAULT_STYLE: DiffStyle = 'unified';

type Listener = () => void;

function readInitial(): DiffStyle {
  if (typeof localStorage === 'undefined') return DEFAULT_STYLE;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'split' || v === 'unified' ? v : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

let current: DiffStyle = readInitial();
const listeners = new Set<Listener>();

// Cross-tab sync: another tab's localStorage write fires `storage` here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next: DiffStyle = e.newValue === 'split' ? 'split' : 'unified';
    if (next === current) return;
    current = next;
    for (const l of listeners) l();
  });
}

export function getDiffStyle(): DiffStyle {
  return current;
}

export function setDiffStyle(next: DiffStyle): void {
  if (next !== 'unified' && next !== 'split') return;
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore — pref still applies in-memory for this session.
  }
  for (const l of listeners) l();
}

export function subscribeDiffStyle(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
