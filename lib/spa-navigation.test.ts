import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  installPushStatePatch,
  subscribeToLocationChanges,
} from './spa-navigation';

const EVENT_NAME = 'ghdiffs:test-locationchange';

// jsdom mutates `history.pushState`/`replaceState` in place when we patch
// them. Snapshot the originals before each test and restore in afterEach so
// the tests don't leak monkey-patches across cases.
let originalPushState: typeof history.pushState;
let originalReplaceState: typeof history.replaceState;

beforeEach(() => {
  originalPushState = history.pushState;
  originalReplaceState = history.replaceState;
});

afterEach(() => {
  history.pushState = originalPushState;
  history.replaceState = originalReplaceState;
});

describe('installPushStatePatch', () => {
  it('dispatches the named event after a pushState call', () => {
    installPushStatePatch(EVENT_NAME);
    const fn = vi.fn();
    document.addEventListener(EVENT_NAME, fn);

    history.pushState({}, '', '/foo');

    expect(fn).toHaveBeenCalledTimes(1);
    document.removeEventListener(EVENT_NAME, fn);
  });

  it('dispatches the named event after a replaceState call', () => {
    installPushStatePatch(EVENT_NAME);
    const fn = vi.fn();
    document.addEventListener(EVENT_NAME, fn);

    history.replaceState({}, '', '/bar');

    expect(fn).toHaveBeenCalledTimes(1);
    document.removeEventListener(EVENT_NAME, fn);
  });

  it('still updates location.pathname after pushState', () => {
    installPushStatePatch(EVENT_NAME);
    history.pushState({}, '', '/some-pr/changes');
    expect(location.pathname).toBe('/some-pr/changes');
  });

  it('is idempotent — calling install twice does not double-dispatch', () => {
    installPushStatePatch(EVENT_NAME);
    installPushStatePatch(EVENT_NAME);

    const fn = vi.fn();
    document.addEventListener(EVENT_NAME, fn);
    history.pushState({}, '', '/foo');

    expect(fn).toHaveBeenCalledTimes(1);
    document.removeEventListener(EVENT_NAME, fn);
  });

  it('does not throw when pushState is called with no url argument', () => {
    installPushStatePatch(EVENT_NAME);
    expect(() => history.pushState({ a: 1 }, '')).not.toThrow();
  });
});

describe('subscribeToLocationChanges', () => {
  it('fires the callback on the named custom event', () => {
    const fn = vi.fn();
    const unsub = subscribeToLocationChanges(fn, EVENT_NAME);

    document.dispatchEvent(new CustomEvent(EVENT_NAME));

    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('fires the callback on popstate (back/forward)', () => {
    const fn = vi.fn();
    const unsub = subscribeToLocationChanges(fn, EVENT_NAME);

    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('fires the callback on legacy turbo:load events', () => {
    const fn = vi.fn();
    const unsub = subscribeToLocationChanges(fn, EVENT_NAME);

    document.dispatchEvent(new CustomEvent('turbo:load'));

    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('returns an unsubscribe function that removes all listeners', () => {
    const fn = vi.fn();
    const unsub = subscribeToLocationChanges(fn, EVENT_NAME);
    unsub();

    document.dispatchEvent(new CustomEvent(EVENT_NAME));
    window.dispatchEvent(new PopStateEvent('popstate'));
    document.dispatchEvent(new CustomEvent('turbo:load'));

    expect(fn).not.toHaveBeenCalled();
  });
});

describe('installPushStatePatch + subscribeToLocationChanges', () => {
  it('callback fires when pushState is called from the same realm', () => {
    installPushStatePatch(EVENT_NAME);
    const fn = vi.fn();
    const unsub = subscribeToLocationChanges(fn, EVENT_NAME);

    history.pushState({}, '', '/conversation-to-files');

    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('callback fires for both pushState and replaceState', () => {
    installPushStatePatch(EVENT_NAME);
    const fn = vi.fn();
    const unsub = subscribeToLocationChanges(fn, EVENT_NAME);

    history.pushState({}, '', '/a');
    history.replaceState({}, '', '/b');

    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
  });
});
