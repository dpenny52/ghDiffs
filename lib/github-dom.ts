/**
 * Thin DOM helpers for locating GitHub PR diff elements on the new
 * "Changes" PR view (route `/pull/:id/changes`).
 *
 * Selectors discovered live (April 2026) on github.com:
 *
 *  - File list parent: `[data-testid="progressive-diffs-list"]`
 *      Contains one wrapper div per file. New files arrive here as the user
 *      scrolls (progressive / lazy loading), so this is the right node to
 *      MutationObserver.
 *
 *  - File container: `[id^="diff-"]` whose className contains
 *      `Diff-module__diffTargetable`. Each container hosts:
 *          [0] header div (`Diff-module__diffHeaderWrapper__*`)
 *          [1] body wrapper div (`border position-relative rounded-bottom-2`)
 *      The body wrapper holds a `<table class="... DiffLines-module__tableLayoutFixed_*">`
 *      when the file is expanded.
 *
 *  - File path: read from `h3 a code` text inside the container's header.
 *      GitHub injects U+200E LEFT-TO-RIGHT MARKs around the path text and
 *      sometimes wraps inner segments with empty `<!-- -->` comments — the
 *      visible path is reliable after stripping bidi marks.
 *
 * The legacy `/files` view (selectors like `[data-tagsearch-path]`,
 * `.js-file`, `.diff-table`) is no longer reachable: GitHub server-redirects
 * `/files` → `/changes`. We don't bother probing legacy selectors here.
 */

const FILE_CONTAINER_SELECTOR = '[id^="diff-"][class*="Diff-module__diffTargetable"]';
const FILE_LIST_PARENT_SELECTOR = '[data-testid="progressive-diffs-list"]';
const PATH_LINK_SELECTOR = 'h3 a code';

// Strip Unicode bidi/control marks GitHub inserts around path text:
//  U+200E (LEFT-TO-RIGHT MARK), U+200F (RIGHT-TO-LEFT MARK),
//  U+200B (ZERO WIDTH SPACE), U+202A-U+202E (bidi embedding).
const BIDI_MARK_RE = /[​‎‏‪-‮]/g;

export function findAllFileContainers(root: ParentNode = document): HTMLElement[] {
  const list = root.querySelectorAll<HTMLElement>(FILE_CONTAINER_SELECTOR);
  return Array.from(list);
}

export function findFileListParent(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(FILE_LIST_PARENT_SELECTOR);
}

export function getFilePath(container: HTMLElement): string | null {
  const code = container.querySelector(PATH_LINK_SELECTOR);
  if (!code) return null;
  const text = code.textContent ?? '';
  const cleaned = text.replace(BIDI_MARK_RE, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Locate the diff body element for a file container — the element we hide
 * and mount React next to.
 *
 * We prefer the wrapper div (second child of the container, holding the
 * diff table) so that hiding it removes the entire diff area while leaving
 * the file header (path, view button, comment count) untouched.
 *
 * Defensive fallbacks: if the container shape changes, fall back to the
 * first descendant `<table>` whose className mentions DiffLines, and then
 * to the container's last element child as a coarse heuristic.
 */
export function getDiffBody(container: HTMLElement): HTMLElement | null {
  // Preferred: the second top-level child div, identified by its border classes.
  const children = Array.from(container.children) as HTMLElement[];
  for (const child of children) {
    if (child instanceof HTMLElement && child.tagName === 'DIV') {
      const cls = child.className || '';
      if (typeof cls === 'string' && /\brounded-bottom-2\b/.test(cls)) {
        return child;
      }
    }
  }

  // Fallback: nearest descendant DiffLines table — wrap-up via parent.
  const table = container.querySelector<HTMLElement>(
    'table[class*="DiffLines-module"]',
  );
  if (table?.parentElement) return table.parentElement;
  if (table) return table;

  return null;
}
