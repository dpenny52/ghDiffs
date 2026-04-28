import { describe, expect, it, vi } from 'vitest';
import { deleteReviewComment } from './delete-review-comment';

const baseOpts = {
  owner: 'octo',
  repo: 'cat',
  prNumber: 42,
  fetchNonce: 'v2:nonce-value',
  commentId: 999,
};

function emptyResponse(status = 200): Response {
  return new Response(null, { status });
}

describe('deleteReviewComment', () => {
  it('DELETEs the right URL with the captured headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(204));
    await deleteReviewComment({ ...baseOpts, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      'https://github.com/octo/cat/pull/42/page_data/review_comments/999',
    );
    expect(init.method).toBe('DELETE');
    expect(init.credentials).toBe('include');
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'GitHub-Is-React': 'true',
      'GitHub-Verified-Fetch': 'true',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Fetch-Nonce': 'v2:nonce-value',
    });
    expect(init.body).toBeUndefined();
  });

  it('returns ok:true on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(200));
    const result = await deleteReviewComment({ ...baseOpts, fetchImpl });
    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false with status on 404', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('Not Found', { status: 404 }));
    const result = await deleteReviewComment({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toMatch(/404/);
    }
  });

  it('returns ok:false on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'));
    const result = await deleteReviewComment({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/network/i);
  });

  it('returns ok:false on abort', async () => {
    const ac = new AbortController();
    const fetchImpl = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    ) as unknown as typeof fetch;
    const promise = deleteReviewComment({
      ...baseOpts,
      signal: ac.signal,
      fetchImpl,
    });
    ac.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toMatch(/abort/);
  });
});
