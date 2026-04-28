import type { FetchRawFileResponse } from './messages';

export type FetchRawFileOptions = {
  owner: string;
  repo: string;
  sha: string;
  path: string;
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

export async function fetchRawFile(
  opts: FetchRawFileOptions,
): Promise<FetchRawFileResponse> {
  const { owner, repo, sha, path, signal } = opts;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${encodeURIComponent(sha)}/${encodeURI(path)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      credentials: 'include',
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, error: 'request aborted (timeout or cancelled)' };
    }
    return {
      ok: false,
      error: `network error: ${errorMessage(err)}`,
    };
  }

  if (!response.ok) {
    let bodySnippet = '';
    try {
      const text = await response.text();
      bodySnippet = text.slice(0, 200);
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

  let content: string;
  try {
    content = await response.text();
  } catch (err) {
    return {
      ok: false,
      status: response.status,
      error: `failed to read response body: ${errorMessage(err)}`,
    };
  }

  return { ok: true, content };
}
