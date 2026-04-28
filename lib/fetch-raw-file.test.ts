import { describe, expect, it, vi } from 'vitest';
import { fetchRawFile } from './fetch-raw-file';

function makeResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

describe('fetchRawFile', () => {
  it('returns ok with content body on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse('hello\nworld\n', 200),
    );

    const result = await fetchRawFile({
      owner: 'octo',
      repo: 'cat',
      sha: 'b14cf8e0b14cf8e0b14cf8e0b14cf8e0b14cf8e0',
      path: 'src/foo.ts',
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      content: 'hello\nworld\n',
    });
  });

  it('calls fetch with the correct URL and credentials: include', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse('', 200));

    await fetchRawFile({
      owner: 'octo',
      repo: 'cat',
      sha: '3e59c7fe3e59c7fe3e59c7fe3e59c7fe3e59c7fe',
      path: 'src/foo.ts',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      'https://github.com/octo/cat/raw/3e59c7fe3e59c7fe3e59c7fe3e59c7fe3e59c7fe/src/foo.ts',
    );
    expect(init).toMatchObject({ credentials: 'include' });
  });

  it('encodes owner and repo with encodeURIComponent and preserves path slashes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse('', 200));

    await fetchRawFile({
      owner: 'weird owner',
      repo: 'repo/with#chars',
      sha: 'abc123',
      path: 'src/sub dir/file.ts',
      fetchImpl,
    });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      `https://github.com/${encodeURIComponent('weird owner')}/${encodeURIComponent('repo/with#chars')}/raw/${encodeURIComponent('abc123')}/${encodeURI('src/sub dir/file.ts')}`,
    );
    // Sanity-check: the path's slashes are NOT percent-encoded.
    expect(url).toContain('/src/sub%20dir/file.ts');
  });

  it('returns ok:false with status on 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse('Not Found', 404));

    const result = await fetchRawFile({
      owner: 'octo',
      repo: 'cat',
      sha: 'abc',
      path: 'missing.ts',
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

    const result = await fetchRawFile({
      owner: 'octo',
      repo: 'cat',
      sha: 'abc',
      path: 'foo.ts',
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

    const result = await fetchRawFile({
      owner: 'octo',
      repo: 'cat',
      sha: 'abc',
      path: 'foo.ts',
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

    const promise = fetchRawFile({
      owner: 'octo',
      repo: 'cat',
      sha: 'abc',
      path: 'foo.ts',
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
