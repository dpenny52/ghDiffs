/**
 * GitHub's React-rendered pages embed a per-page nonce in
 * `<meta name="fetch-nonce" content="...">` and require it as the
 * `X-Fetch-Nonce` header on internal `/page_data/...` POST/DELETE calls.
 *
 * Read it from the isolated content script (which has DOM access) and
 * forward to the service worker so SW-side fetches can include it.
 */
export function readFetchNonce(root: ParentNode = document): string | null {
  const meta = root.querySelector('meta[name="fetch-nonce"]');
  if (!meta) return null;
  const value = meta.getAttribute('content');
  if (!value || value.length === 0) return null;
  return value;
}
