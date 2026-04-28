import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  MultiFileDiff,
  PatchDiff,
  type DiffLineAnnotation,
  type FileContents,
} from '@pierre/diffs/react';
import {
  getDiffStyle,
  setDiffStyle,
  subscribeDiffStyle,
  type DiffStyle,
} from './diff-style-store';
import type { ReviewCommentSide } from './messages';

export type Mounted = {
  unmount: () => void;
};

export type { FileContents };

export type CommentSide = ReviewCommentSide;

export type PostCommentFn = (input: {
  text: string;
  line: number;
  side: CommentSide;
  path: string;
}) => Promise<
  { ok: true; commentId: number } | { ok: false; error: string }
>;

export type DeleteCommentFn = (
  commentId: number,
) => Promise<{ ok: true } | { ok: false; error: string }>;

export type CommentCallbacks = {
  onPostComment: PostCommentFn;
  onDeleteComment: DeleteCommentFn;
};

export type ExistingComment = {
  id: number;
  body: string;
  bodyHTML: string;
  author: string | null;
  avatarUrl: string | null;
  canDelete: boolean;
};

export type ExistingThread = {
  side: CommentSide;
  line: number;
  isResolved: boolean;
  comments: ExistingComment[];
};

const BASE_DIFF_OPTIONS = {
  theme: { dark: 'ayu-dark', light: 'ayu-light' },
  enableGutterUtility: true,
} as const;

function useReactiveDiffStyle(): DiffStyle {
  return useSyncExternalStore(subscribeDiffStyle, getDiffStyle, getDiffStyle);
}

/**
 * Mount `<PatchDiff patch={patch} />` into `host`. The caller is responsible
 * for inserting `host` into the DOM at the right place. The theme follows
 * the OS color scheme via prefers-color-scheme (handled by @pierre/diffs).
 *
 * Returns a cleanup handle. Calling `unmount()` is idempotent.
 */
export function mountPatchDiff(host: HTMLElement, patch: string): Mounted {
  const root: Root = createRoot(host);
  root.render(<ReactivePatchDiff patch={patch} />);
  return makeUnmounter(root);
}

function ReactivePatchDiff({ patch }: { patch: string }) {
  const diffStyle = useReactiveDiffStyle();
  return (
    <PatchDiff
      patch={patch}
      options={{ ...BASE_DIFF_OPTIONS, diffStyle }}
    />
  );
}

/**
 * Mount `<MultiFileDiff>` into `host` using full base/head file contents.
 * Unlike `mountPatchDiff`, this gives `@pierre/diffs` enough context to
 * enable expand-context buttons (the library disables them when `isPartial`
 * is true; non-partial requires full file contents).
 *
 * If `callbacks` is provided, the diff also exposes an "add comment" `+`
 * button on the gutter and an inline composer/posted-comment list as
 * line annotations, wired to the provided async callbacks.
 */
export function mountMultiFile(
  host: HTMLElement,
  oldFile: FileContents,
  newFile: FileContents,
  callbacks?: CommentCallbacks,
  existingThreads?: ExistingThread[],
): Mounted {
  ensureMarkdownStylesInjected();
  const root: Root = createRoot(host);
  if (callbacks) {
    root.render(
      <MultiFileDiffWithComments
        oldFile={oldFile}
        newFile={newFile}
        onPostComment={callbacks.onPostComment}
        onDeleteComment={callbacks.onDeleteComment}
        existingThreads={existingThreads ?? []}
      />,
    );
  } else if (existingThreads && existingThreads.length > 0) {
    // We have existing threads but no post/delete callbacks (e.g. nonce
    // missing) — still render the threads read-only via the wrapper, with
    // no-op callbacks that surface a friendly error.
    root.render(
      <MultiFileDiffWithComments
        oldFile={oldFile}
        newFile={newFile}
        onPostComment={async () => ({
          ok: false as const,
          error: 'comment posting unavailable on this page',
        })}
        onDeleteComment={async () => ({
          ok: false as const,
          error: 'comment deletion unavailable on this page',
        })}
        existingThreads={existingThreads}
      />,
    );
  } else {
    root.render(
      <ReactiveMultiFileDiff oldFile={oldFile} newFile={newFile} />,
    );
  }
  return makeUnmounter(root);
}

function ReactiveMultiFileDiff({
  oldFile,
  newFile,
}: {
  oldFile: FileContents;
  newFile: FileContents;
}) {
  const diffStyle = useReactiveDiffStyle();
  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={{ ...BASE_DIFF_OPTIONS, diffStyle }}
    />
  );
}

// ---------------------------------------------------------------------------
// Markdown stylesheet (injected once per page)
// ---------------------------------------------------------------------------
//
// `dangerouslySetInnerHTML` drops sanitized GitHub bodyHTML into the diff
// container, which inherits Pierre's monospace font and the page's heading
// sizes. Without a reset, an `<h3>` lands at ~28px and the prose stays
// monospace. This keeps the comment body looking like a comment.
const MARKDOWN_STYLE_ID = 'ghdiffs-markdown-styles';

function ensureMarkdownStylesInjected() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(MARKDOWN_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MARKDOWN_STYLE_ID;
  style.textContent = MARKDOWN_CSS;
  document.head.appendChild(style);
}

const MARKDOWN_CSS = `
.ghdiffs-markdown-body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: var(--fgColor-default, #1f2328);
  /* The diff is rendered inside a <pre>, so every descendant inherits
     white-space: pre. Force normal wrapping inside the comment body. */
  white-space: normal;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  min-width: 0;
}
.ghdiffs-markdown-body * { min-width: 0; white-space: inherit; }
.ghdiffs-markdown-body pre { white-space: pre; }
.ghdiffs-markdown-body code { word-break: break-word; white-space: normal; }
.ghdiffs-markdown-body pre code { white-space: pre; }
.ghdiffs-markdown-body > *:first-child { margin-top: 0; }
.ghdiffs-markdown-body > *:last-child { margin-bottom: 0; }
.ghdiffs-markdown-body p { margin: 0 0 12px; }
.ghdiffs-markdown-body h1,
.ghdiffs-markdown-body h2,
.ghdiffs-markdown-body h3,
.ghdiffs-markdown-body h4,
.ghdiffs-markdown-body h5,
.ghdiffs-markdown-body h6 {
  margin: 18px 0 10px;
  font-weight: 600;
  line-height: 1.3;
}
.ghdiffs-markdown-body h1 { font-size: 1.15em; }
.ghdiffs-markdown-body h2 { font-size: 1.1em; }
.ghdiffs-markdown-body h3 { font-size: 1.05em; }
.ghdiffs-markdown-body h4,
.ghdiffs-markdown-body h5,
.ghdiffs-markdown-body h6 { font-size: 1em; }
.ghdiffs-markdown-body strong { font-weight: 600; }
.ghdiffs-markdown-body code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.85em;
  padding: 0.15em 0.35em;
  background: var(--bgColor-neutral-muted, rgba(175, 184, 193, 0.2));
  border-radius: 4px;
}
.ghdiffs-markdown-body pre {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.45;
  background: var(--bgColor-muted, #f6f8fa);
  padding: 8px 10px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 12px 0;
}
.ghdiffs-markdown-body pre code {
  background: transparent;
  padding: 0;
  font-size: inherit;
  border-radius: 0;
}
.ghdiffs-markdown-body blockquote {
  margin: 12px 0;
  padding: 0 12px;
  border-left: 3px solid var(--borderColor-muted, #d1d9e0);
  color: var(--fgColor-muted, #59636e);
}
.ghdiffs-markdown-body ul,
.ghdiffs-markdown-body ol {
  margin: 12px 0;
  padding-left: 22px;
}
.ghdiffs-markdown-body li { margin: 4px 0; }
.ghdiffs-markdown-body a {
  color: var(--fgColor-accent, #0969da);
  text-decoration: none;
}
.ghdiffs-markdown-body a:hover { text-decoration: underline; }
.ghdiffs-markdown-body hr {
  border: 0;
  border-top: 1px solid var(--borderColor-muted, #d1d9e0);
  margin: 8px 0;
}
.ghdiffs-markdown-body img { max-width: 100%; }
.ghdiffs-markdown-body table {
  border-collapse: collapse;
  margin: 6px 0;
  font-size: 12px;
}
.ghdiffs-markdown-body table th,
.ghdiffs-markdown-body table td {
  border: 1px solid var(--borderColor-muted, #d1d9e0);
  padding: 4px 8px;
}
.ghdiffs-markdown-body details { margin: 12px 0; }
.ghdiffs-markdown-body details summary { padding: 4px 0; }
.ghdiffs-markdown-body details summary { cursor: pointer; font-weight: 600; }
`;

/**
 * Mount the diff-style toggle toolbar (unified vs. split). Sits above the
 * file list; one instance per page. Switching the toggle updates the
 * shared `diff-style-store`, which every mounted diff subscribes to.
 */
export function mountToolbar(host: HTMLElement): Mounted {
  const root: Root = createRoot(host);
  root.render(<DiffStyleToolbar />);
  return makeUnmounter(root);
}

function DiffStyleToolbar() {
  const diffStyle = useReactiveDiffStyle();
  return (
    <div className="ghdiffs-toolbar" style={toolbarStyle}>
      <span style={toolbarLabelStyle}>Diff layout</span>
      <div role="group" style={toolbarGroupStyle}>
        <ToolbarButton
          active={diffStyle === 'unified'}
          onClick={() => setDiffStyle('unified')}
          label="Unified"
        />
        <ToolbarButton
          active={diffStyle === 'split'}
          onClick={() => setDiffStyle('split')}
          label="Split"
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={active ? toolbarBtnActiveStyle : toolbarBtnStyle}
    >
      {label}
    </button>
  );
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  marginBottom: 8,
  border: '1px solid var(--borderColor-default, #d0d7de)',
  borderRadius: 6,
  background: 'var(--bgColor-muted, #f6f8fa)',
};

const toolbarLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--fgColor-muted, #59636e)',
};

const toolbarGroupStyle: React.CSSProperties = {
  display: 'inline-flex',
  border: '1px solid var(--borderColor-default, #d0d7de)',
  borderRadius: 6,
  overflow: 'hidden',
  background: 'var(--bgColor-default, #fff)',
};

const toolbarBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  border: 'none',
  background: 'transparent',
  color: 'var(--fgColor-default, #1f2328)',
  fontSize: 13,
  cursor: 'pointer',
};

const toolbarBtnActiveStyle: React.CSSProperties = {
  ...toolbarBtnStyle,
  background: 'var(--bgColor-accent-emphasis, #0969da)',
  color: '#ffffff',
  fontWeight: 600,
};

function makeUnmounter(root: Root): Mounted {
  let unmounted = false;
  return {
    unmount: () => {
      if (unmounted) return;
      unmounted = true;
      try {
        root.unmount();
      } catch {
        // ignore; nothing actionable.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Comment-aware wrapper
// ---------------------------------------------------------------------------

type LineKey = `${CommentSide}:${number}`;

type ThreadKey = string;

type PostedComment = {
  id: number;
  text: string;
  /** Pre-sanitized HTML from GitHub (existing comments only). Empty for
   * session-posted comments — those render as plain text. */
  bodyHTML: string;
  author: string | null;
  avatarUrl: string | null;
  canDelete: boolean;
};

type CommentThread = {
  threadKey: ThreadKey;
  isResolved: boolean;
  comments: PostedComment[];
};

type AnnotationMeta = { key: LineKey };

type Props = {
  oldFile: FileContents;
  newFile: FileContents;
  onPostComment: PostCommentFn;
  onDeleteComment: DeleteCommentFn;
  existingThreads: ExistingThread[];
};

function makeKey(side: CommentSide, line: number): LineKey {
  return `${side}:${line}`;
}

function parseKey(key: LineKey): { side: CommentSide; line: number } {
  const [side, lineStr] = key.split(':') as [CommentSide, string];
  return { side, line: Number(lineStr) };
}

function seedThreadsFromExisting(
  existing: ExistingThread[],
): Map<LineKey, CommentThread[]> {
  const out = new Map<LineKey, CommentThread[]>();
  for (const t of existing) {
    if (t.comments.length === 0) continue;
    const key = makeKey(t.side, t.line);
    const thread: CommentThread = {
      threadKey: `existing-${t.comments[0].id}`,
      isResolved: t.isResolved,
      comments: t.comments.map((c) => ({
        id: c.id,
        text: c.body,
        bodyHTML: c.bodyHTML,
        author: c.author,
        avatarUrl: c.avatarUrl,
        canDelete: c.canDelete,
      })),
    };
    const list = out.get(key) ?? [];
    out.set(key, [...list, thread]);
  }
  return out;
}

function MultiFileDiffWithComments({
  oldFile,
  newFile,
  onPostComment,
  onDeleteComment,
  existingThreads,
}: Props) {
  const [composers, setComposers] = useState<Map<LineKey, string>>(new Map());
  const [threads, setThreads] = useState<Map<LineKey, CommentThread[]>>(() =>
    seedThreadsFromExisting(existingThreads),
  );
  const [expanded, setExpanded] = useState<Set<ThreadKey>>(new Set());
  const [pending, setPending] = useState<Set<LineKey>>(new Set());
  const [errors, setErrors] = useState<Map<LineKey, string>>(new Map());

  const toggleExpanded = useCallback((threadKey: ThreadKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(threadKey)) next.delete(threadKey);
      else next.add(threadKey);
      return next;
    });
  }, []);

  const openComposer = useCallback((line: number, side: CommentSide) => {
    const key = makeKey(side, line);
    setComposers((prev) => {
      if (prev.has(key)) return prev;
      const next = new Map(prev);
      next.set(key, '');
      return next;
    });
  }, []);

  const updateComposer = useCallback((key: LineKey, text: string) => {
    setComposers((prev) => {
      const next = new Map(prev);
      next.set(key, text);
      return next;
    });
  }, []);

  const cancelComposer = useCallback((key: LineKey) => {
    setComposers((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const submitComposer = useCallback(
    async (key: LineKey) => {
      const text = composers.get(key);
      if (!text || text.trim().length === 0) return;
      const { side, line } = parseKey(key);
      const path = side === 'left' ? oldFile.name : newFile.name;
      setPending((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setErrors((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      const result = await onPostComment({ text, line, side, path });
      setPending((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      if (result.ok) {
        setThreads((prev) => {
          const next = new Map(prev);
          const list = next.get(key) ?? [];
          const newThread: CommentThread = {
            threadKey: `session-${result.commentId}`,
            isResolved: false,
            comments: [
              {
                id: result.commentId,
                text,
                bodyHTML: '',
                author: null,
                avatarUrl: null,
                canDelete: true,
              },
            ],
          };
          next.set(key, [...list, newThread]);
          return next;
        });
        setComposers((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      } else {
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(key, result.error);
          return next;
        });
      }
    },
    [composers, oldFile.name, newFile.name, onPostComment],
  );

  const deleteComment = useCallback(
    async (key: LineKey, commentId: number) => {
      const result = await onDeleteComment(commentId);
      if (result.ok) {
        setThreads((prev) => {
          const list = prev.get(key);
          if (!list) return prev;
          const updatedThreads: CommentThread[] = [];
          for (const t of list) {
            const remaining = t.comments.filter((c) => c.id !== commentId);
            if (remaining.length > 0) {
              updatedThreads.push({ ...t, comments: remaining });
            }
          }
          const next = new Map(prev);
          if (updatedThreads.length === 0) next.delete(key);
          else next.set(key, updatedThreads);
          return next;
        });
      } else {
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(key, result.error);
          return next;
        });
      }
    },
    [onDeleteComment],
  );

  const lineAnnotations = useMemo<DiffLineAnnotation<AnnotationMeta>[]>(() => {
    const keys = new Set<LineKey>();
    for (const k of composers.keys()) keys.add(k);
    for (const k of threads.keys()) keys.add(k);
    const out: DiffLineAnnotation<AnnotationMeta>[] = [];
    for (const key of keys) {
      const { side, line } = parseKey(key);
      out.push({
        side: side === 'left' ? 'deletions' : 'additions',
        lineNumber: line,
        metadata: { key },
      });
    }
    return out;
  }, [composers, threads]);

  const renderGutterUtility = useCallback(
    (
      getHoveredLine: () =>
        | { lineNumber: number; side: 'deletions' | 'additions' }
        | undefined,
    ) => (
      <button
        type="button"
        aria-label="Add comment"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const hover = getHoveredLine();
          if (!hover) return;
          const side: CommentSide =
            hover.side === 'deletions' ? 'left' : 'right';
          openComposer(hover.lineNumber, side);
        }}
        style={addCommentBtnStyle}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            fill="currentColor"
            d="M7.25 2a.75.75 0 0 1 1.5 0v5.25H14a.75.75 0 0 1 0 1.5H8.75V14a.75.75 0 0 1-1.5 0V8.75H2a.75.75 0 0 1 0-1.5h5.25Z"
          />
        </svg>
      </button>
    ),
    [openComposer],
  );

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationMeta>) => {
      const key = annotation.metadata.key;
      const lineThreads = threads.get(key) ?? [];
      const composerText = composers.get(key);
      const isPending = pending.has(key);
      const errorMsg = errors.get(key);
      return (
        <div className="ghdiffs-annotation" style={annotationStyle}>
          {lineThreads.map((thread) => {
            const isExpanded = expanded.has(thread.threadKey);
            if (thread.isResolved && !isExpanded) {
              return (
                <ResolvedThreadPill
                  key={thread.threadKey}
                  thread={thread}
                  onExpand={() => toggleExpanded(thread.threadKey)}
                />
              );
            }
            return (
              <div
                key={thread.threadKey}
                className="ghdiffs-thread"
                style={threadStyle}
              >
                {thread.isResolved && (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(thread.threadKey)}
                    style={resolvedHideBtnStyle}
                    aria-label="Collapse resolved thread"
                  >
                    Resolved · hide
                  </button>
                )}
                {thread.comments.map((c) => (
                  <CommentItem
                    key={c.id}
                    comment={c}
                    onDelete={() => deleteComment(key, c.id)}
                  />
                ))}
              </div>
            );
          })}
          {composerText !== undefined && (
            <div className="ghdiffs-composer" style={composerStyle}>
              <textarea
                value={composerText}
                disabled={isPending}
                onChange={(e) => updateComposer(key, e.target.value)}
                placeholder="Leave a comment"
                rows={3}
                style={textareaStyle}
              />
              {errorMsg && <div style={errorStyle}>{errorMsg}</div>}
              <div style={btnRowStyle}>
                <button
                  type="button"
                  onClick={() => cancelComposer(key)}
                  disabled={isPending}
                  style={smallBtnStyle}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => submitComposer(key)}
                  disabled={isPending || composerText.trim().length === 0}
                  style={primaryBtnStyle}
                >
                  {isPending ? 'Posting…' : 'Comment'}
                </button>
              </div>
            </div>
          )}
        </div>
      );
    },
    [
      threads,
      composers,
      pending,
      errors,
      expanded,
      toggleExpanded,
      updateComposer,
      cancelComposer,
      submitComposer,
      deleteComment,
    ],
  );

  const diffStyle = useReactiveDiffStyle();

  return (
    <MultiFileDiff<AnnotationMeta>
      oldFile={oldFile}
      newFile={newFile}
      options={{ ...BASE_DIFF_OPTIONS, diffStyle }}
      lineAnnotations={lineAnnotations}
      renderAnnotation={renderAnnotation}
      renderGutterUtility={renderGutterUtility}
    />
  );
}

// Pushed far enough left to sit on top of the addition/deletion bar
// indicator (the colored stripe to the left of the line numbers), out of
// the way of the line-number digits. Page background + white icon/outline
// keeps it visible against any line-stripe color.
const addCommentBtnStyle: React.CSSProperties = {
  position: 'absolute',
  transform: 'translateX(calc(-100% - 26px))',
  width: 20,
  height: 20,
  padding: 0,
  border: '1px solid #ffffff',
  borderRadius: 6,
  background: 'var(--bgColor-default, #0d1117)',
  color: '#ffffff',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
};

function CommentItem({
  comment,
  onDelete,
}: {
  comment: PostedComment;
  onDelete: () => void;
}) {
  return (
    <div className="ghdiffs-comment" style={commentStyle}>
      {(comment.author || comment.avatarUrl) && (
        <div style={authorRowStyle}>
          <Avatar url={comment.avatarUrl} login={comment.author} size={20} />
          {comment.author && <span style={authorStyle}>{comment.author}</span>}
        </div>
      )}
      {comment.bodyHTML ? (
        <div
          className="ghdiffs-markdown-body"
          style={markdownBodyStyle}
          // GitHub returns a sanitized bodyHTML for review comments. We're
          // already running in the page context on github.com, so trusting
          // their HTML here matches the threat model of every other script
          // on this page.
          dangerouslySetInnerHTML={{ __html: comment.bodyHTML }}
        />
      ) : (
        <pre style={commentTextStyle}>{comment.text}</pre>
      )}
      {comment.canDelete && (
        <div style={btnRowStyle}>
          <button type="button" onClick={onDelete} style={smallBtnStyle}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({
  url,
  login,
  size,
}: {
  url: string | null;
  login: string | null;
  size: number;
}) {
  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-block',
    background: 'var(--bgColor-muted, #d8dee4)',
    overflow: 'hidden',
  };
  if (url) {
    return (
      <img
        src={url}
        alt={login ?? 'avatar'}
        width={size}
        height={size}
        style={baseStyle}
      />
    );
  }
  // Initial-letter fallback when we have no avatar URL.
  const initial = (login ?? '?').charAt(0).toUpperCase();
  return (
    <span
      style={{
        ...baseStyle,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.55),
        fontWeight: 600,
        color: 'var(--fgColor-muted, #59636e)',
      }}
      aria-label={login ?? 'unknown author'}
    >
      {initial}
    </span>
  );
}

function ResolvedThreadPill({
  thread,
  onExpand,
}: {
  thread: CommentThread;
  onExpand: () => void;
}) {
  // Dedupe by login while preserving the first avatar URL we saw.
  const seen = new Map<string, { login: string; avatarUrl: string | null }>();
  for (const c of thread.comments) {
    if (!c.author) continue;
    if (!seen.has(c.author)) {
      seen.set(c.author, { login: c.author, avatarUrl: c.avatarUrl });
    }
  }
  const distinctAuthors = Array.from(seen.values());
  const count = thread.comments.length;
  const namesText =
    distinctAuthors.length === 0
      ? ''
      : ` by ${distinctAuthors
          .slice(0, 3)
          .map((a) => a.login)
          .join(', ')}${distinctAuthors.length > 3 ? '…' : ''}`;
  const summary = `${count} comment${count === 1 ? '' : 's'}${namesText}`;
  return (
    <button
      type="button"
      onClick={onExpand}
      style={resolvedPillStyle}
      aria-label={`Expand resolved thread (${summary})`}
    >
      <span style={resolvedDotStyle} aria-hidden="true" />
      {distinctAuthors.slice(0, 3).map((a) => (
        <Avatar key={a.login} url={a.avatarUrl} login={a.login} size={16} />
      ))}
      <span>Resolved · {summary}</span>
      <span style={resolvedExpandHintStyle}>show</span>
    </button>
  );
}

const annotationStyle: React.CSSProperties = {
  padding: '8px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxWidth: 760,
};

const threadStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const commentStyle: React.CSSProperties = {
  border: '1px solid var(--borderColor-default, #d0d7de)',
  borderRadius: 6,
  padding: '12px 14px',
  background: 'var(--bgColor-muted, #f6f8fa)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
  boxSizing: 'border-box',
  overflowWrap: 'anywhere',
};

const commentTextStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  fontFamily: 'inherit',
  fontSize: 15,
};

const authorRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const authorStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--fgColor-default, #1f2328)',
};

const markdownBodyStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.5,
  // Sanitized GitHub HTML — sized via the injected `.ghdiffs-markdown-body`
  // stylesheet (see `ensureMarkdownStylesInjected`).
  margin: 0,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
};

const resolvedPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  alignSelf: 'flex-start',
  padding: '4px 10px',
  border: '1px solid var(--borderColor-muted, #d8dee4)',
  borderRadius: 999,
  background: 'var(--bgColor-muted, #f6f8fa)',
  color: 'var(--fgColor-muted, #59636e)',
  cursor: 'pointer',
  fontSize: 12,
};

const resolvedDotStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: 'var(--bgColor-success-emphasis, #1a7f37)',
};

const resolvedExpandHintStyle: React.CSSProperties = {
  fontWeight: 600,
  textDecoration: 'underline',
};

const resolvedHideBtnStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: '2px 8px',
  border: '1px solid var(--borderColor-muted, #d8dee4)',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--fgColor-muted, #59636e)',
  cursor: 'pointer',
  fontSize: 11,
};

const composerStyle: React.CSSProperties = {
  border: '1px solid var(--borderColor-default, #d0d7de)',
  borderRadius: 6,
  padding: 8,
  background: 'var(--bgColor-default, #fff)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 60,
  fontFamily: 'inherit',
  fontSize: 13,
  padding: 6,
  border: '1px solid var(--borderColor-default, #d0d7de)',
  borderRadius: 4,
  resize: 'vertical',
  boxSizing: 'border-box',
};

const errorStyle: React.CSSProperties = {
  color: 'var(--fgColor-danger, #cf222e)',
  fontSize: 12,
};

const btnRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  justifyContent: 'flex-end',
};

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  border: '1px solid var(--borderColor-default, #d0d7de)',
  borderRadius: 4,
  background: 'var(--bgColor-muted, #f6f8fa)',
  cursor: 'pointer',
  fontSize: 12,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #1a7f37',
  borderRadius: 4,
  background: '#2da44e',
  color: 'white',
  cursor: 'pointer',
  fontSize: 12,
};
