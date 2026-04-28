/**
 * SPA navigation detection helpers.
 *
 * GitHub's React-based PR view (April 2026, the `/changes` route) switches
 * between tabs (Conversation / Files / Commits / Checks) via React Router's
 * `history.pushState`. Neither `popstate` nor `turbo:load` fires for those
 * calls, so a content script that only listens to those events misses every
 * tab change and only "wakes up" on a full page reload.
 *
 * The fix is two halves:
 *
 *  1. `installPushStatePatch` (MAIN world): wraps `history.pushState` and
 *     `history.replaceState` so each call dispatches a `document` CustomEvent
 *     of the caller's choosing.
 *
 *  2. `subscribeToLocationChanges` (ISOLATED world): listens for that custom
 *     event, plus `popstate` and the legacy `turbo:load`, and invokes a
 *     callback so the caller can re-evaluate `location.href`.
 *
 * Step 1 has to run in MAIN — patches in the isolated world only intercept
 * calls made from the isolated world; the page's own `pushState` calls go
 * through their own JS reference and bypass the patch entirely.
 */

const PATCH_FLAG = '__ghdiffsHistoryPatched';

type Patched = typeof history.pushState & { [PATCH_FLAG]?: boolean };

/**
 * The CustomEvent name dispatched on `document` after each pushState or
 * replaceState. Shared between MAIN-world install and ISOLATED-world
 * subscribe so the two halves stay in sync.
 */
export const LOCATION_CHANGE_EVENT = 'ghdiffs:locationchange';

/**
 * Patch `history.pushState` and `history.replaceState` in the current realm
 * so that every successful call dispatches a `document` CustomEvent named
 * `eventName`. Idempotent: a second call in the same realm is a no-op.
 *
 * Must be called from the MAIN world for the patch to see page-side calls.
 */
export function installPushStatePatch(eventName: string): void {
  if ((history.pushState as Patched)[PATCH_FLAG]) return;

  const wrap = (method: 'pushState' | 'replaceState') => {
    const orig = history[method].bind(history);
    const patched = ((
      data: unknown,
      unused: string,
      url?: string | URL | null,
    ): void => {
      orig(data, unused, url);
      document.dispatchEvent(new CustomEvent(eventName));
    }) as Patched;
    patched[PATCH_FLAG] = true;
    history[method] = patched;
  };

  wrap('pushState');
  wrap('replaceState');
}

/**
 * Subscribe to all signals that the URL may have changed:
 *   - `eventName` (the event installed by `installPushStatePatch`)
 *   - `popstate` (back/forward navigation)
 *   - `turbo:load` (legacy GitHub navigation; harmless on pages that never
 *      dispatch it)
 *
 * Returns a function that removes every listener it attached.
 */
export function subscribeToLocationChanges(
  callback: () => void,
  eventName: string,
): () => void {
  const fn = () => callback();
  document.addEventListener(eventName, fn);
  window.addEventListener('popstate', fn);
  document.addEventListener('turbo:load', fn);
  return () => {
    document.removeEventListener(eventName, fn);
    window.removeEventListener('popstate', fn);
    document.removeEventListener('turbo:load', fn);
  };
}
