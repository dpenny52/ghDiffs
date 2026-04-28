import { describe, expect, it, vi } from 'vitest';
import { fetchDiff } from './fetch-diff';

function makeResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

describe('fetchDiff', () => {
  it('returns ok with patch body on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse('diff --git a/foo b/foo\n+hello\n', 200),
    );

    const result = await fetchDiff({
      owner: 'octo',
      repo: 'cat',
      prNumber: 7,
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      patch: 'diff --git a/foo b/foo\n+hello\n',
    });
  });

  it('calls fetch with the correct URL and credentials: include', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse('', 200));

    await fetchDiff({
      owner: 'octo',
      repo: 'cat',
      prNumber: 42,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://github.com/octo/cat/pull/42.diff');
    expect(init).toMatchObject({ credentials: 'include' });
  });

  it('encodes owner and repo with weird-but-legal characters', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse('', 200));

    await fetchDiff({
      owner: 'weird owner',
      repo: 'repo/with#chars',
      prNumber: 1,
      fetchImpl,
    });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      `https://github.com/${encodeURIComponent('weird owner')}/${encodeURIComponent('repo/with#chars')}/pull/1.diff`,
    );
  });

  it('returns ok:false with status on 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse('Not Found', 404));

    const result = await fetchDiff({
      owner: 'octo',
      repo: 'cat',
      prNumber: 99,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(404);
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('returns ok:false with status on 500', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse('Server Error', 500));

    const result = await fetchDiff({
      owner: 'octo',
      repo: 'cat',
      prNumber: 1,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBe(500);
      expect(typeof result.error).toBe('string');
    }
  });

  it('returns ok:false without status on network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));

    const result = await fetchDiff({
      owner: 'octo',
      repo: 'cat',
      prNumber: 1,
      fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBeUndefined();
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('returns ok:false with abort-mentioning error when aborted mid-fetch', async () => {
    const ac = new AbortController();
    const fetchImpl = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new DOMException('aborted', 'AbortError');
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    const promise = fetchDiff({
      owner: 'octo',
      repo: 'cat',
      prNumber: 1,
      signal: ac.signal,
      fetchImpl,
    });

    ac.abort();
    const result = await promise;

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.status).toBeUndefined();
      expect(result.error.toLowerCase()).toMatch(/abort/);
    }
  });
});
