/**
 * Parse pre-existing review-thread comments out of GitHub's embedded
 * `pullRequestsChangesRoute` JSON payload.
 *
 * Shape (April 2026, observed in the wild):
 *
 *   payload.pullRequestsChangesRoute = {
 *     diffSummaries: [
 *       {
 *         path: "reg/.../foo.py",
 *         markersMap: {
 *           "R36": { threads: [{id: 2113323996}], annotations: [], ctx: [33,39] },
 *           "L299": { threads: [{id: ...}], ... },
 *           ...
 *         },
 *         ...
 *       },
 *       ...
 *     ],
 *     markers: {
 *       threads: {
 *         "2113323996": {
 *           id: "...",
 *           isResolved: bool,
 *           commentsData: { comments: [<comment>, ...] },
 *           ...
 *         },
 *         ...
 *       }
 *     }
 *   }
 *
 * The marker key encodes side+line: `R<n>` = right side line `n`,
 * `L<n>` = left side. Each comment object has `body`, `databaseId`,
 * `author.login`, and `viewerCanDelete`.
 */

export type ExistingCommentSide = 'left' | 'right';

export type ExistingComment = {
  id: number;
  body: string;
  bodyHTML: string;
  author: string | null;
  avatarUrl: string | null;
  canDelete: boolean;
};

export type ExistingThread = {
  side: ExistingCommentSide;
  line: number;
  isResolved: boolean;
  comments: ExistingComment[];
};

export type ExistingThreadsByPath = Map<string, ExistingThread[]>;

const MARKER_KEY_RE = /^([LR])(\d+)$/;

/**
 * Find and parse the script tag that holds `pullRequestsChangesRoute`.
 * Returns `null` if the payload can't be located or parsed.
 */
export function readExistingThreads(
  root: ParentNode = document,
): ExistingThreadsByPath | null {
  const scripts = root.querySelectorAll('script');
  for (let i = 0; i < scripts.length; i++) {
    const text = scripts[i].textContent ?? '';
    if (!text || !text.includes('"pullRequestsChangesRoute"')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const result = parseThreadsFromPayload(parsed);
    if (result) return result;
  }
  return null;
}

export function parseThreadsFromPayload(
  payload: unknown,
): ExistingThreadsByPath | null {
  const route = (payload as {
    payload?: { pullRequestsChangesRoute?: unknown };
  })?.payload?.pullRequestsChangesRoute;
  if (!route || typeof route !== 'object') return null;

  const r = route as {
    diffSummaries?: unknown;
    markers?: { threads?: Record<string, unknown> };
  };

  const summaries = r.diffSummaries;
  const threadsMap = r.markers?.threads;
  if (!Array.isArray(summaries) || !threadsMap || typeof threadsMap !== 'object') {
    return null;
  }

  const out: ExistingThreadsByPath = new Map();

  for (const summary of summaries) {
    if (!summary || typeof summary !== 'object') continue;
    const s = summary as { path?: unknown; markersMap?: unknown };
    if (typeof s.path !== 'string' || !s.markersMap || typeof s.markersMap !== 'object') {
      continue;
    }
    const markersMap = s.markersMap as Record<string, unknown>;
    const fileThreads: ExistingThread[] = [];

    for (const markerKey of Object.keys(markersMap)) {
      const m = MARKER_KEY_RE.exec(markerKey);
      if (!m) continue;
      const side: ExistingCommentSide = m[1] === 'L' ? 'left' : 'right';
      const line = Number(m[2]);
      if (!Number.isFinite(line) || line <= 0) continue;

      const entry = markersMap[markerKey] as { threads?: unknown };
      const threadRefs = Array.isArray(entry?.threads) ? entry.threads : [];
      if (threadRefs.length === 0) continue;

      const comments: ExistingComment[] = [];
      let isResolved = false;
      for (const ref of threadRefs) {
        const id = (ref as { id?: unknown })?.id;
        if (id === undefined || id === null) continue;
        const tid = typeof id === 'string' ? id : String(id);
        const thread = threadsMap[tid];
        const parsedComments = parseCommentsFromThread(thread);
        if (parsedComments.isResolved) isResolved = true;
        for (const c of parsedComments.comments) comments.push(c);
      }
      if (comments.length === 0) continue;
      fileThreads.push({ side, line, isResolved, comments });
    }

    if (fileThreads.length > 0) out.set(s.path, fileThreads);
  }

  return out;
}

function parseCommentsFromThread(thread: unknown): {
  comments: ExistingComment[];
  isResolved: boolean;
} {
  const empty = { comments: [] as ExistingComment[], isResolved: false };
  if (!thread || typeof thread !== 'object') return empty;
  const t = thread as {
    isResolved?: unknown;
    commentsData?: { comments?: unknown };
  };
  const commentsRaw = t.commentsData?.comments;
  if (!Array.isArray(commentsRaw)) return empty;
  const comments: ExistingComment[] = [];
  for (const raw of commentsRaw) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as {
      databaseId?: unknown;
      body?: unknown;
      bodyHTML?: unknown;
      author?: { login?: unknown; avatarUrl?: unknown };
      viewerCanDelete?: unknown;
    };
    const id =
      typeof c.databaseId === 'number'
        ? c.databaseId
        : typeof c.databaseId === 'string' && /^\d+$/.test(c.databaseId)
          ? Number(c.databaseId)
          : null;
    if (id === null) continue;
    const body = typeof c.body === 'string' ? c.body : '';
    const bodyHTML = typeof c.bodyHTML === 'string' ? c.bodyHTML : '';
    const author =
      typeof c.author?.login === 'string' ? c.author.login : null;
    const avatarUrl =
      typeof c.author?.avatarUrl === 'string' && c.author.avatarUrl.length > 0
        ? c.author.avatarUrl
        : null;
    const canDelete = c.viewerCanDelete === true;
    comments.push({ id, body, bodyHTML, author, avatarUrl, canDelete });
  }
  return {
    comments,
    isResolved: t.isResolved === true,
  };
}
