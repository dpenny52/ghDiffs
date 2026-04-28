import { createRoot, type Root } from 'react-dom/client';
import {
  MultiFileDiff,
  PatchDiff,
  type FileContents,
} from '@pierre/diffs/react';

export type Mounted = {
  unmount: () => void;
};

export type { FileContents };

const SHARED_DIFF_OPTIONS = {
  theme: { dark: 'ayu-dark', light: 'ayu-light' },
  diffStyle: 'unified',
} as const;

/**
 * Mount `<PatchDiff patch={patch} />` into `host`. The caller is responsible
 * for inserting `host` into the DOM at the right place. The theme follows
 * the OS color scheme via prefers-color-scheme (handled by @pierre/diffs).
 *
 * Returns a cleanup handle. Calling `unmount()` is idempotent.
 */
export function mountPatchDiff(host: HTMLElement, patch: string): Mounted {
  const root: Root = createRoot(host);
  root.render(<PatchDiff patch={patch} options={SHARED_DIFF_OPTIONS} />);
  return makeUnmounter(root);
}

/**
 * Mount `<MultiFileDiff>` into `host` using full base/head file contents.
 * Unlike `mountPatchDiff`, this gives `@pierre/diffs` enough context to
 * enable expand-context buttons (the library disables them when `isPartial`
 * is true; non-partial requires full file contents).
 */
export function mountMultiFile(
  host: HTMLElement,
  oldFile: FileContents,
  newFile: FileContents,
): Mounted {
  const root: Root = createRoot(host);
  root.render(
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={SHARED_DIFF_OPTIONS}
    />,
  );
  return makeUnmounter(root);
}

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
