import type { DeleteReviewCommentResponse } from './messages';

export type DeleteReviewCommentOptions = {
  owner: string;
  repo: string;
  prNumber: number;
  fetchNonce: string;
  commentId: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  ) {
    return true;
  }
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  return 'unknown error';
}

export async function deleteReviewComment(
  opts: DeleteReviewCommentOptions,
): Promise<DeleteReviewCommentResponse> {
  const { owner, repo, prNumber, fetchNonce, commentId, signal } = opts;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${String(prNumber)}/page_data/review_comments/${String(commentId)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'DELETE',
      credentials: 'include',
      signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'GitHub-Is-React': 'true',
        'GitHub-Verified-Fetch': 'true',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Fetch-Nonce': fetchNonce,
      },
    });
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, error: 'request aborted (timeout or cancelled)' };
    }
    return { ok: false, error: `network error: ${errorMessage(err)}` };
  }

  if (!response.ok) {
    let bodySnippet = '';
    try {
      bodySnippet = (await response.text()).slice(0, 200);
    } catch {
      // ignore body read errors
    }
    const detail = bodySnippet ? `: ${bodySnippet}` : '';
    return {
      ok: false,
      status: response.status,
      error: `github responded ${response.status} ${response.statusText}${detail}`,
    };
  }

  return { ok: true };
}
