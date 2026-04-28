import { describe, expect, it, vi } from 'vitest';
import { postReviewComment } from './post-review-comment';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const baseOpts = {
  owner: 'octo',
  repo: 'cat',
  prNumber: 42,
  baseOid: 'b'.repeat(40),
  headOid: 'h'.repeat(40),
  fetchNonce: 'v2:nonce-value',
  path: 'src/foo.ts',
  line: 17,
  side: 'right' as const,
  text: 'looks great',
};

describe('postReviewComment', () => {
  it('POSTs to the right URL with the captured headers and JSON body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ comment: { databaseId: 999 } }));

    await postReviewComment({ ...baseOpts, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      'https://github.com/octo/cat/pull/42/page_data/create_review_comment',
    );
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'GitHub-Is-React': 'true',
      'GitHub-Verified-Fetch': 'true',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Fetch-Nonce': 'v2:nonce-value',
    });

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      comparisonStartOid: baseOpts.baseOid,
      comparisonEndOid: baseOpts.headOid,
      text: 'looks great',
      submitBatch: true,
      line: 17,
      path: 'src/foo.ts',
      positioning: {
        type: 'line',
        baseCommitOid: baseOpts.baseOid,
        headCommitOid: baseOpts.headOid,
        path: 'src/foo.ts',
        line: 17,
        commitOid: baseOpts.headOid,
      },
      side: 'right',
      subjectType: 'line',
    });
  });

  it('uses left/old-path positioning when side is left', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ databaseId: 1 }));

    await postReviewComment({
      ...baseOpts,
      side: 'left',
      path: 'src/old.ts',
      line: 3,
      fetchImpl,
    });

    const init = fetchImpl.mock.calls[0]![1];
    const body = JSON.parse(init.body);
    expect(body.side).toBe('left');
    expect(body.path).toBe('src/old.ts');
    expect(body.positioning.path).toBe('src/old.ts');
    expect(body.positioning.line).toBe(3);
  });

  it('returns ok:true with commentId for various response shapes', async () => {
    const shapes: Array<[unknown, number]> = [
      // The shape GitHub actually returns (April 2026): nested under
      // `thread.commentsData.comments[].databaseId`. Top-level `id` is a
      // base64 GraphQL node id and must NOT match.
      [
        {
          thread: {
            id: 'PRRC_kwDOnodeid',
            commentsData: {
              comments: [
                { id: 'PRRC_kwDOnodeid', databaseId: 3151681769 },
              ],
            },
          },
          comment: { id: 'PRRC_kwDOnodeid', databaseId: 3151681769 },
        },
        3151681769,
      ],
      [{ databaseId: 111 }, 111],
      [{ comment_id: 222 }, 222],
      [{ comment: { databaseId: 333 } }, 333],
      [{ data: { comment: { databaseId: 444 } } }, 444],
      [{ databaseId: '555' }, 555],
    ];
    for (const [payload, expected] of shapes) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload));
      const result = await postReviewComment({ ...baseOpts, fetchImpl });
      expect(result).toEqual({ ok: true, commentId: expected });
    }
  });

  it('does NOT match the GraphQL `id` field — that is a non-numeric node id', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'PRRC_kwDOnodeid' }));
    const result = await postReviewComment({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
  });

  it('returns ok:false when the response has no usable id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
    const result = await postReviewComment({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toMatch(/comment id/);
    }
  });

  it('returns ok:false with status on 422', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"error":"invalid line"}', {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await postReviewComment({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.error).toMatch(/422/);
    }
  });

  it('returns ok:false on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'));
    const result = await postReviewComment({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBeUndefined();
      expect(result.error).toMatch(/network/i);
    }
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
    const promise = postReviewComment({
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
