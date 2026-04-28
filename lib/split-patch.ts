export type SplitFile = {
  oldPath: string;
  newPath: string;
  patch: string;
};

const DIFF_HEADER_RE = /^diff --git (?:"a\/(.+?)"|a\/(\S+)) (?:"b\/(.+?)"|b\/(\S+))$/;
const RENAME_FROM_RE = /^rename from (?:"(.+)"|(.+))$/;
const RENAME_TO_RE = /^rename to (?:"(.+)"|(.+))$/;

/**
 * Split a unified diff (output of `git diff` or GitHub's `.diff` endpoint)
 * into one entry per file section.
 *
 * Each returned entry's `patch` is the verbatim text of that section,
 * starting at its `diff --git` line and ending just before the next
 * `diff --git` line (or EOF). For added files the oldPath is `/dev/null`;
 * for deleted files the newPath is `/dev/null`. Renames pull paths from the
 * `rename from` / `rename to` lines when present, falling back to the
 * `diff --git` header otherwise.
 */
export function splitUnifiedDiff(patch: string): SplitFile[] {
  if (!patch || patch.trim().length === 0) return [];

  const lines = patch.split('\n');
  const sectionStartIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('diff --git ')) sectionStartIndices.push(i);
  }
  if (sectionStartIndices.length === 0) return [];

  const sections: SplitFile[] = [];
  for (let s = 0; s < sectionStartIndices.length; s++) {
    const start = sectionStartIndices[s];
    const isLast = s + 1 >= sectionStartIndices.length;
    const end = isLast ? lines.length : sectionStartIndices[s + 1];
    const sectionLines = lines.slice(start, end);
    // When this section is followed by another, the original text had a '\n'
    // between this section's last content line and the next 'diff --git'
    // line. Re-add that trailing '\n' so each section's `patch` is exactly
    // the substring of the original from its 'diff --git' up to (but not
    // including) the next one.
    const sectionText = sectionLines.join('\n') + (isLast ? '' : '\n');

    const { oldPath, newPath } = extractPaths(sectionLines);
    sections.push({ oldPath, newPath, patch: sectionText });
  }

  return sections;
}

function extractPaths(sectionLines: string[]): { oldPath: string; newPath: string } {
  // The first line is the diff --git header.
  const header = sectionLines[0] ?? '';
  const headerMatch = header.match(DIFF_HEADER_RE);
  // Default fallback (also covers the 'modified' case where old===new).
  let oldPath = headerMatch ? (headerMatch[1] ?? headerMatch[2] ?? '') : '';
  let newPath = headerMatch ? (headerMatch[3] ?? headerMatch[4] ?? '') : '';

  let isNewFile = false;
  let isDeletedFile = false;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;

  // Scan only the metadata lines before the first hunk / content.
  // Hunks start with `@@`; content ('-', '+', ' ') lives below them.
  for (let i = 1; i < sectionLines.length; i++) {
    const line = sectionLines[i];
    if (line.startsWith('@@')) break;
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (line === 'new file mode' || line.startsWith('new file mode ')) {
      isNewFile = true;
      continue;
    }
    if (line === 'deleted file mode' || line.startsWith('deleted file mode ')) {
      isDeletedFile = true;
      continue;
    }
    const rf = line.match(RENAME_FROM_RE);
    if (rf) {
      renameFrom = rf[1] ?? rf[2] ?? null;
      continue;
    }
    const rt = line.match(RENAME_TO_RE);
    if (rt) {
      renameTo = rt[1] ?? rt[2] ?? null;
      continue;
    }
  }

  if (renameFrom) oldPath = renameFrom;
  if (renameTo) newPath = renameTo;
  if (isNewFile) oldPath = '/dev/null';
  if (isDeletedFile) newPath = '/dev/null';

  return { oldPath, newPath };
}
