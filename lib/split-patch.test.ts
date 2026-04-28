import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { splitUnifiedDiff } from './split-patch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sampleDiff = readFileSync(resolve(__dirname, '__fixtures__/sample.diff'), 'utf8');

describe('splitUnifiedDiff', () => {
  describe('empty / invalid input', () => {
    it('returns [] for empty string', () => {
      expect(splitUnifiedDiff('')).toEqual([]);
    });

    it('returns [] for whitespace only', () => {
      expect(splitUnifiedDiff('   \n\n')).toEqual([]);
    });

    it('returns [] for input with no diff --git markers', () => {
      expect(splitUnifiedDiff('this is not a diff\nat all\n')).toEqual([]);
    });
  });

  describe('three-file fixture: add, delete, modify', () => {
    const result = splitUnifiedDiff(sampleDiff);

    it('returns exactly 3 entries', () => {
      expect(result).toHaveLength(3);
    });

    it('parses added file with /dev/null as oldPath', () => {
      const added = result[0];
      expect(added.oldPath).toBe('/dev/null');
      expect(added.newPath).toBe('src/added.ts');
    });

    it('added file patch starts with diff --git and contains new file mode', () => {
      const added = result[0];
      expect(added.patch.startsWith('diff --git a/src/added.ts b/src/added.ts')).toBe(true);
      expect(added.patch).toContain('new file mode');
      expect(added.patch).toContain('+export function hello()');
    });

    it('parses deleted file with /dev/null as newPath', () => {
      const deleted = result[1];
      expect(deleted.oldPath).toBe('src/deleted.ts');
      expect(deleted.newPath).toBe('/dev/null');
    });

    it('deleted file patch contains deleted file mode', () => {
      const deleted = result[1];
      expect(deleted.patch.startsWith('diff --git a/src/deleted.ts b/src/deleted.ts')).toBe(true);
      expect(deleted.patch).toContain('deleted file mode');
      expect(deleted.patch).toContain('-export function goodbye()');
    });

    it('parses modified file with same path on both sides', () => {
      const modified = result[2];
      expect(modified.oldPath).toBe('src/modified.ts');
      expect(modified.newPath).toBe('src/modified.ts');
    });

    it('modified file patch starts with its own diff --git header', () => {
      const modified = result[2];
      expect(modified.patch.startsWith('diff --git a/src/modified.ts b/src/modified.ts')).toBe(true);
      expect(modified.patch).toContain('-  return `Hello, ${name}`;');
      expect(modified.patch).toContain('+  return `Hi, ${name}!`;');
    });

    it('does not bleed content from one section into another', () => {
      const [added, deleted, modified] = result;
      expect(added.patch).not.toContain('src/deleted.ts');
      expect(added.patch).not.toContain('src/modified.ts');
      expect(deleted.patch).not.toContain('src/added.ts');
      expect(deleted.patch).not.toContain('src/modified.ts');
      expect(modified.patch).not.toContain('src/added.ts');
      expect(modified.patch).not.toContain('src/deleted.ts');
    });
  });

  describe('renames', () => {
    it('extracts oldPath/newPath from rename from / rename to lines', () => {
      const renameDiff = `diff --git a/old/path.ts b/new/path.ts
similarity index 95%
rename from old/path.ts
rename to new/path.ts
index 1111111..2222222 100644
--- a/old/path.ts
+++ b/new/path.ts
@@ -1,3 +1,3 @@
 line one
-line two
+line two changed
 line three
`;
      const result = splitUnifiedDiff(renameDiff);
      expect(result).toHaveLength(1);
      expect(result[0].oldPath).toBe('old/path.ts');
      expect(result[0].newPath).toBe('new/path.ts');
    });

    it('falls back to diff --git header when rename lines are absent', () => {
      const headerOnly = `diff --git a/foo.ts b/bar.ts
index 1111111..2222222 100644
--- a/foo.ts
+++ b/bar.ts
@@ -1 +1 @@
-old
+new
`;
      const result = splitUnifiedDiff(headerOnly);
      expect(result).toHaveLength(1);
      expect(result[0].oldPath).toBe('foo.ts');
      expect(result[0].newPath).toBe('bar.ts');
    });
  });

  describe('quoted paths', () => {
    it('unquotes paths wrapped in double quotes', () => {
      const quoted = `diff --git "a/path with space.ts" "b/path with space.ts"
index 1111111..2222222 100644
--- "a/path with space.ts"
+++ "b/path with space.ts"
@@ -1 +1 @@
-old
+new
`;
      const result = splitUnifiedDiff(quoted);
      expect(result).toHaveLength(1);
      expect(result[0].oldPath).toBe('path with space.ts');
      expect(result[0].newPath).toBe('path with space.ts');
    });
  });

  describe('binary files', () => {
    it('preserves binary diffs without erroring', () => {
      const binary = `diff --git a/img.png b/img.png
index 1111111..2222222 100644
Binary files a/img.png and b/img.png differ
`;
      const result = splitUnifiedDiff(binary);
      expect(result).toHaveLength(1);
      expect(result[0].oldPath).toBe('img.png');
      expect(result[0].newPath).toBe('img.png');
      expect(result[0].patch).toContain('Binary files a/img.png and b/img.png differ');
    });

    it('handles binary file added (new file mode + Binary files)', () => {
      const binaryAdded = `diff --git a/new.png b/new.png
new file mode 100644
index 0000000..2222222
Binary files /dev/null and b/new.png differ
`;
      const result = splitUnifiedDiff(binaryAdded);
      expect(result).toHaveLength(1);
      expect(result[0].oldPath).toBe('/dev/null');
      expect(result[0].newPath).toBe('new.png');
    });
  });

  describe('boundary handling', () => {
    it('does not split on lines that merely contain "diff --git" mid-line', () => {
      const tricky = `diff --git a/file.ts b/file.ts
index 1111111..2222222 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 // a comment that mentions diff --git a/foo b/foo for fun
-old line
+new line
`;
      const result = splitUnifiedDiff(tricky);
      expect(result).toHaveLength(1);
      expect(result[0].patch).toContain('// a comment that mentions diff --git a/foo b/foo for fun');
    });

    it('preserves trailing newline behavior between sections', () => {
      const result = splitUnifiedDiff(sampleDiff);
      // The first two entries should each end with a newline (since they're followed by another diff)
      expect(result[0].patch.endsWith('\n')).toBe(true);
      expect(result[1].patch.endsWith('\n')).toBe(true);
    });
  });
});
