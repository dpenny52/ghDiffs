import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'ghdiffs:diffStyle';

async function freshImport() {
  vi.resetModules();
  return import('./diff-style-store');
}

describe('diff-style-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to unified when nothing is stored', async () => {
    const { getDiffStyle } = await freshImport();
    expect(getDiffStyle()).toBe('unified');
  });

  it('reads a previously persisted value', async () => {
    localStorage.setItem(STORAGE_KEY, 'split');
    const { getDiffStyle } = await freshImport();
    expect(getDiffStyle()).toBe('split');
  });

  it('ignores garbage values and falls back to unified', async () => {
    localStorage.setItem(STORAGE_KEY, 'banana');
    const { getDiffStyle } = await freshImport();
    expect(getDiffStyle()).toBe('unified');
  });

  it('setDiffStyle persists and notifies subscribers', async () => {
    const { getDiffStyle, setDiffStyle, subscribeDiffStyle } =
      await freshImport();
    const fn = vi.fn();
    const unsub = subscribeDiffStyle(fn);

    setDiffStyle('split');
    expect(getDiffStyle()).toBe('split');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('split');
    expect(fn).toHaveBeenCalledTimes(1);

    setDiffStyle('split'); // same value, no notification
    expect(fn).toHaveBeenCalledTimes(1);

    setDiffStyle('unified');
    expect(getDiffStyle()).toBe('unified');
    expect(fn).toHaveBeenCalledTimes(2);

    unsub();
    setDiffStyle('split');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid values via setDiffStyle', async () => {
    const { setDiffStyle, getDiffStyle } = await freshImport();
    setDiffStyle('not-a-style' as unknown as 'split');
    expect(getDiffStyle()).toBe('unified');
  });

  it('cross-tab updates via storage event', async () => {
    const { getDiffStyle, subscribeDiffStyle } = await freshImport();
    const fn = vi.fn();
    subscribeDiffStyle(fn);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: STORAGE_KEY,
        newValue: 'split',
      }),
    );
    expect(getDiffStyle()).toBe('split');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
