import { describe, it, expect, beforeEach } from 'vitest';
import {
  findAllFileContainers,
  findFileListParent,
  getFilePath,
  getDiffBody,
} from './github-dom';

/**
 * Build a synthetic DOM fragment that matches what we observed live on
 * GitHub's `/pull/:id/changes` page (April 2026). See `github-dom.ts` for
 * the full selector / structure notes.
 */
function buildFileEntry(opts: {
  diffId: string;
  path: string;
  /** When true, include the U+200E bidi marks GitHub wraps the path with. */
  withBidiMarks?: boolean;
  /** When false, the body wrapper is collapsed (no table). */
  expanded?: boolean;
}): HTMLElement {
  const entry = document.createElement('div');
  entry.className = 'PullRequestDiffsList-module__diffEntry__djnVa';

  const container = document.createElement('div');
  container.id = opts.diffId;
  container.className =
    'Diff-module__diffTargetable__pirZi Diff-module__diff__rx9XH';

  // Header
  const header = document.createElement('div');
  header.className = 'Diff-module__diffHeaderWrapper__UgUyv';

  const h3 = document.createElement('h3');
  h3.className = 'DiffFileHeader-module__file-name__VVXpg';
  const a = document.createElement('a');
  a.className = 'Link--primary prc-Link-Link-9ZwDx';
  a.href = `#${opts.diffId}`;
  const code = document.createElement('code');
  if (opts.withBidiMarks) {
    code.textContent = `‎${opts.path}‎`;
  } else {
    code.textContent = opts.path;
  }
  a.appendChild(code);
  h3.appendChild(a);
  header.appendChild(h3);

  // Body wrapper
  const body = document.createElement('div');
  body.className = 'border position-relative rounded-bottom-2';
  if (opts.expanded !== false) {
    const table = document.createElement('table');
    table.className =
      'tab-size width-full DiffLines-module__tableLayoutFixed__Ui4OU';
    body.appendChild(table);
  }

  container.appendChild(header);
  container.appendChild(body);
  entry.appendChild(container);
  return entry;
}

function buildFileList(entries: HTMLElement[]): HTMLElement {
  const parent = document.createElement('div');
  parent.className = 'd-flex flex-column gap-3';
  parent.setAttribute('data-testid', 'progressive-diffs-list');
  parent.setAttribute('data-hpc', 'true');
  for (const e of entries) parent.appendChild(e);
  return parent;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findAllFileContainers', () => {
  it('returns each `[id^="diff-"]` file container', () => {
    const list = buildFileList([
      buildFileEntry({ diffId: 'diff-aaa', path: 'src/a.ts' }),
      buildFileEntry({ diffId: 'diff-bbb', path: 'src/b.ts' }),
    ]);
    document.body.appendChild(list);

    const containers = findAllFileContainers();
    expect(containers).toHaveLength(2);
    expect(containers[0].id).toBe('diff-aaa');
    expect(containers[1].id).toBe('diff-bbb');
  });

  it('returns [] when no diff containers are present', () => {
    document.body.innerHTML =
      '<div><p>nothing here</p><div id="other">foo</div></div>';
    expect(findAllFileContainers()).toEqual([]);
  });

  it('does not match unrelated `id^="diff-"` elements without the diffTargetable class', () => {
    document.body.innerHTML =
      '<div id="diff-comparison-viewer-container"></div>' +
      '<div id="diff-file-tree-filter"></div>';
    expect(findAllFileContainers()).toEqual([]);
  });

  it('respects the optional root scope', () => {
    const a = buildFileEntry({ diffId: 'diff-aaa', path: 'a.ts' });
    const b = buildFileEntry({ diffId: 'diff-bbb', path: 'b.ts' });
    const inside = document.createElement('section');
    inside.appendChild(a);
    document.body.appendChild(inside);
    document.body.appendChild(b);

    const scoped = findAllFileContainers(inside);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].id).toBe('diff-aaa');
  });
});

describe('findFileListParent', () => {
  it('returns the element with `data-testid="progressive-diffs-list"`', () => {
    const list = buildFileList([
      buildFileEntry({ diffId: 'diff-aaa', path: 'a.ts' }),
    ]);
    document.body.appendChild(list);
    const parent = findFileListParent();
    expect(parent).toBe(list);
  });

  it('returns null when no file list parent is in the DOM', () => {
    document.body.innerHTML = '<div><p>placeholder</p></div>';
    expect(findFileListParent()).toBeNull();
  });
});

describe('getFilePath', () => {
  it('extracts the file path text from `h3 a code`', () => {
    const entry = buildFileEntry({
      diffId: 'diff-aaa',
      path: 'packages/foo/bar.ts',
    });
    document.body.appendChild(entry);
    const container = entry.querySelector('[id^="diff-"]') as HTMLElement;
    expect(getFilePath(container)).toBe('packages/foo/bar.ts');
  });

  it('strips the U+200E bidi marks GitHub wraps the path with', () => {
    const entry = buildFileEntry({
      diffId: 'diff-aaa',
      path: 'src/with-bidi.ts',
      withBidiMarks: true,
    });
    document.body.appendChild(entry);
    const container = entry.querySelector('[id^="diff-"]') as HTMLElement;
    expect(getFilePath(container)).toBe('src/with-bidi.ts');
  });

  it('returns null when the path link is missing', () => {
    const container = document.createElement('div');
    container.id = 'diff-empty';
    container.className = 'Diff-module__diffTargetable__pirZi';
    document.body.appendChild(container);
    expect(getFilePath(container)).toBeNull();
  });

  it('returns null when the path text is empty / only whitespace', () => {
    const container = document.createElement('div');
    container.id = 'diff-empty';
    container.className = 'Diff-module__diffTargetable__pirZi';
    container.innerHTML = '<h3><a><code>   </code></a></h3>';
    document.body.appendChild(container);
    expect(getFilePath(container)).toBeNull();
  });
});

describe('getDiffBody', () => {
  it('returns the body wrapper div (expanded file)', () => {
    const entry = buildFileEntry({ diffId: 'diff-aaa', path: 'a.ts' });
    document.body.appendChild(entry);
    const container = entry.querySelector('[id^="diff-"]') as HTMLElement;
    const body = getDiffBody(container);
    expect(body).not.toBeNull();
    expect(body!.tagName).toBe('DIV');
    expect(body!.className).toContain('rounded-bottom-2');
    expect(body!.querySelector('table')).not.toBeNull();
  });

  it('returns the body wrapper even when collapsed (no diff table yet)', () => {
    const entry = buildFileEntry({
      diffId: 'diff-aaa',
      path: 'a.ts',
      expanded: false,
    });
    document.body.appendChild(entry);
    const container = entry.querySelector('[id^="diff-"]') as HTMLElement;
    const body = getDiffBody(container);
    expect(body).not.toBeNull();
    expect(body!.className).toContain('rounded-bottom-2');
    expect(body!.querySelector('table')).toBeNull();
  });

  it('falls back to the diff table parent when the body wrapper class is missing', () => {
    const container = document.createElement('div');
    container.id = 'diff-fallback';
    container.className = 'Diff-module__diffTargetable__pirZi';
    const wrapper = document.createElement('section');
    const table = document.createElement('table');
    table.className = 'DiffLines-module__tableLayoutFixed__Ui4OU';
    wrapper.appendChild(table);
    container.appendChild(wrapper);
    document.body.appendChild(container);

    const body = getDiffBody(container);
    expect(body).toBe(wrapper);
  });

  it('returns null when no diff body shape is recognizable', () => {
    const container = document.createElement('div');
    container.id = 'diff-empty';
    container.className = 'Diff-module__diffTargetable__pirZi';
    container.innerHTML = '<span>only text, no table</span>';
    document.body.appendChild(container);
    expect(getDiffBody(container)).toBeNull();
  });
});
