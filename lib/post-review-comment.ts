import type {
  PostReviewCommentResponse,
  ReviewCommentSide,
} from './messages';

export type PostReviewCommentOptions = {
  owner: string;
  repo: string;
  prNumber: number;
  baseOid: string;
  headOid: string;
  fetchNonce: string;
  path: string;
  line: number;
  side: ReviewCommentSide;
  text: string;
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

function extractCommentId(payload: unknown, depth = 0): number | null {
  if (depth > 6 || payload === null || payload === undefined) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractCommentId(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  // The numeric REST id we need for the delete URL is `databaseId`. The
  // top-level `id` field is a base64 GraphQL node id (e.g. "PRRC_kwDO…")
  // and must not be matched.
  for (const key of [
    'databaseId',
    'comment_id',
    'commentId',
    'reviewCommentId',
  ]) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  }
  for (const nestedKey of [
    'comment',
    'review_comment',
    'reviewComment',
    'thread',
    'commentsData',
    'comments',
    'data',
    'result',
  ]) {
    const nested = obj[nestedKey];
    if (nested !== undefined && nested !== null) {
      const found = extractCommentId(nested, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

export async function postReviewComment(
  opts: PostReviewCommentOptions,
): Promise<PostReviewCommentResponse> {
  const {
    owner,
    repo,
    prNumber,
    baseOid,
    headOid,
    fetchNonce,
    path,
    line,
    side,
    text,
    signal,
  } = opts;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${String(prNumber)}/page_data/create_review_comment`;

  const body = JSON.stringify({
    comparisonStartOid: baseOid,
    comparisonEndOid: headOid,
    text,
    submitBatch: true,
    line,
    path,
    positioning: {
      type: 'line',
      baseCommitOid: baseOid,
      headCommitOid: headOid,
      path,
      line,
      commitOid: headOid,
    },
    side,
    subjectType: 'line',
  });

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
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
      body,
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

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    return {
      ok: false,
      status: response.status,
      error: `failed to parse response: ${errorMessage(err)}`,
    };
  }

  const commentId = extractCommentId(payload);
  if (commentId === null) {
    return {
      ok: false,
      status: response.status,
      error: 'github response did not include a comment id',
    };
  }

  return { ok: true, commentId };
}
