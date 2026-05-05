import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'ghdiffs:diffOverflow';

async function freshImport() {
  vi.resetModules();
  return import('./diff-overflow-store');
}

describe('diff-overflow-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to scroll when nothing is stored', async () => {
    const { getDiffOverflow } = await freshImport();
    expect(getDiffOverflow()).toBe('scroll');
  });

  it('reads a previously persisted value', async () => {
    localStorage.setItem(STORAGE_KEY, 'wrap');
    const { getDiffOverflow } = await freshImport();
    expect(getDiffOverflow()).toBe('wrap');
  });

  it('ignores garbage values and falls back to scroll', async () => {
    localStorage.setItem(STORAGE_KEY, 'banana');
    const { getDiffOverflow } = await freshImport();
    expect(getDiffOverflow()).toBe('scroll');
  });

  it('setDiffOverflow persists and notifies subscribers', async () => {
    const { getDiffOverflow, setDiffOverflow, subscribeDiffOverflow } =
      await freshImport();
    const fn = vi.fn();
    const unsub = subscribeDiffOverflow(fn);

    setDiffOverflow('wrap');
    expect(getDiffOverflow()).toBe('wrap');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('wrap');
    expect(fn).toHaveBeenCalledTimes(1);

    setDiffOverflow('wrap'); // same value, no notification
    expect(fn).toHaveBeenCalledTimes(1);

    setDiffOverflow('scroll');
    expect(getDiffOverflow()).toBe('scroll');
    expect(fn).toHaveBeenCalledTimes(2);

    unsub();
    setDiffOverflow('wrap');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid values via setDiffOverflow', async () => {
    const { setDiffOverflow, getDiffOverflow } = await freshImport();
    setDiffOverflow('not-a-mode' as unknown as 'wrap');
    expect(getDiffOverflow()).toBe('scroll');
  });

  it('cross-tab updates via storage event', async () => {
    const { getDiffOverflow, subscribeDiffOverflow } = await freshImport();
    const fn = vi.fn();
    subscribeDiffOverflow(fn);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: STORAGE_KEY,
        newValue: 'wrap',
      }),
    );
    expect(getDiffOverflow()).toBe('wrap');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
