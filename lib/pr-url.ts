export type PrView = 'files' | 'conversation' | 'commits' | 'checks' | 'other';

export type ParsedPrUrl = {
  owner: string;
  repo: string;
  prNumber: number;
  view: PrView;
};

// GitHub renamed `/files` to `/changes` (April 2026); both are the same
// logical "files changed" view, so we collapse them here.
const KNOWN_VIEWS: Record<string, PrView> = {
  files: 'files',
  changes: 'files',
  commits: 'commits',
  checks: 'checks',
};

/**
 * Parse a GitHub pull-request URL.
 *
 * Returns null for anything that isn't a github.com PR URL of the form
 * `https://github.com/<owner>/<repo>/pull/<number>[/<view>...]` (with an
 * optional query string and/or fragment, both ignored).
 */
export function parsePrUrl(url: string): ParsedPrUrl | null {
  if (typeof url !== 'string' || url.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // Only http/https github.com — strict equality, no subdomains like gist.github.com.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.hostname !== 'github.com') return null;

  // Split the pathname; ignore query and hash by virtue of using parsed.pathname.
  const segments = parsed.pathname.split('/').filter(Boolean);
  // Expect: [owner, repo, "pull", number, ...rest]
  if (segments.length < 4) return null;

  const [owner, repo, kind, prNumberStr, ...rest] = segments;
  if (kind !== 'pull') return null;
  if (!owner || !repo || !prNumberStr) return null;

  // GitHub PR numbers are positive integers. Reject anything else.
  if (!/^[1-9]\d*$/.test(prNumberStr)) return null;
  const prNumber = Number(prNumberStr);
  if (!Number.isFinite(prNumber)) return null;

  const viewSegment = rest[0];
  let view: PrView;
  if (!viewSegment) {
    view = 'conversation';
  } else if (viewSegment in KNOWN_VIEWS) {
    view = KNOWN_VIEWS[viewSegment];
  } else {
    view = 'other';
  }

  return { owner, repo, prNumber, view };
}
