// MAIN-world content script.
//
// MV3 content scripts default to the "isolated" world, which has its own JS
// global where `customElements` is `null`. `@pierre/diffs` synchronously calls
// `customElements.get('diffs-container')` at module-load time and crashes in
// the isolated world. Running in MAIN gives us the page's real custom-element
// registry, so the import succeeds.
//
// This script is a passive event consumer: it receives mount/unmount events
// from the isolated content script and renders <PatchDiff /> / <MultiFileDiff />
// into the host element identified by `data-ghdiffs-host-id`.
//
// For multi-file mounts that include comment metadata (owner/repo/PR/SHAs/
// nonce), it also implements the post/delete callbacks by calling
// `fetch()` *directly from MAIN world*. Doing the fetch here (rather than
// hopping to the service worker) means the browser tags the request with
// the page's origin/referer, which GitHub's `/page_data/` endpoints
// require — a SW fetch sends `Origin: chrome-extension://...` and GitHub
// rejects it with HTML 422.
//
// We also patch `history.pushState`/`replaceState` from MAIN so the isolated
// content script can detect SPA tab switches on the React PR view. Patches
// in the isolated world don't intercept the page's own pushState calls, so
// it has to happen here.

import {
  LOCATION_CHANGE_EVENT,
  installPushStatePatch,
} from '@/lib/spa-navigation';

type Mounted = { unmount: () => void };

type CommentSide = 'right' | 'left';

type CommentsMeta = {
  owner: string;
  repo: string;
  prNumber: number;
  baseOid: string;
  headOid: string;
  fetchNonce: string;
};

type ExistingComment = {
  id: number;
  body: string;
  bodyHTML: string;
  author: string | null;
  avatarUrl: string | null;
  canDelete: boolean;
};

type ExistingThread = {
  side: CommentSide;
  line: number;
  isResolved: boolean;
  comments: ExistingComment[];
};

type MountFilesDetail = {
  hostId: string;
  oldFile: { name: string; contents: string };
  newFile: { name: string; contents: string };
  comments?: CommentsMeta;
  existingThreads?: ExistingThread[];
};

type PostCommentResult =
  | { ok: true; commentId: number }
  | { ok: false; error: string };

type DeleteCommentResult = { ok: true } | { ok: false; error: string };

export default defineContentScript({
  matches: ['https://github.com/*/pull/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  async main() {
    // Install the pushState/replaceState patch as early as possible so we
    // catch the very first React Router navigation. This is synchronous and
    // doesn't touch customElements, so it's safe before the heavy import.
    installPushStatePatch(LOCATION_CHANGE_EVENT);

    // Lazy-import so any module-level customElements code in @pierre/diffs
    // executes in the MAIN world (where customElements actually exists).
    const { mountPatchDiff, mountMultiFile, mountToolbar } = await import(
      '@/lib/render'
    );
    const { postReviewComment } = await import('@/lib/post-review-comment');
    const { deleteReviewComment } = await import('@/lib/delete-review-comment');

    const roots = new Map<string, Mounted>();

    const READY_EVENT = 'ghdiffs:main-ready';
    const POLL_EVENT = 'ghdiffs:isolated-poll';
    const MOUNT_EVENT = 'ghdiffs:mount';
    const MOUNT_FILES_EVENT = 'ghdiffs:mountFiles';
    const MOUNT_TOOLBAR_EVENT = 'ghdiffs:mountToolbar';
    const UNMOUNT_EVENT = 'ghdiffs:unmount';

    function findHost(hostId: string): HTMLElement | null {
      return document.querySelector<HTMLElement>(
        `[data-ghdiffs-host-id="${CSS.escape(hostId)}"]`,
      );
    }

    document.addEventListener(MOUNT_EVENT, (e) => {
      const ev = e as CustomEvent<{ hostId: string; patch: string }>;
      const detail = ev.detail;
      if (
        !detail ||
        typeof detail.hostId !== 'string' ||
        typeof detail.patch !== 'string'
      ) {
        return;
      }
      const host = findHost(detail.hostId);
      if (!host) return;
      roots.get(detail.hostId)?.unmount();
      try {
        const m = mountPatchDiff(host, detail.patch);
        roots.set(detail.hostId, m);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[ghDiffs:main] mount failed for hostId', detail.hostId, err);
      }
    });

    document.addEventListener(MOUNT_FILES_EVENT, (e) => {
      const ev = e as CustomEvent<MountFilesDetail>;
      const detail = ev.detail;
      if (
        !detail ||
        typeof detail.hostId !== 'string' ||
        !detail.oldFile ||
        typeof detail.oldFile.name !== 'string' ||
        typeof detail.oldFile.contents !== 'string' ||
        !detail.newFile ||
        typeof detail.newFile.name !== 'string' ||
        typeof detail.newFile.contents !== 'string'
      ) {
        return;
      }
      const host = findHost(detail.hostId);
      if (!host) return;
      roots.get(detail.hostId)?.unmount();

      const callbacks = detail.comments
        ? makeCommentCallbacks(detail.comments)
        : undefined;

      try {
        const m = mountMultiFile(
          host,
          detail.oldFile,
          detail.newFile,
          callbacks,
          detail.existingThreads,
        );
        roots.set(detail.hostId, m);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          '[ghDiffs:main] mountFiles failed for hostId',
          detail.hostId,
          err,
        );
      }
    });

    function makeCommentCallbacks(meta: CommentsMeta) {
      return {
        onPostComment: async (input: {
          text: string;
          line: number;
          side: CommentSide;
          path: string;
        }): Promise<PostCommentResult> => {
          const res = await postReviewComment({
            owner: meta.owner,
            repo: meta.repo,
            prNumber: meta.prNumber,
            baseOid: meta.baseOid,
            headOid: meta.headOid,
            fetchNonce: meta.fetchNonce,
            path: input.path,
            line: input.line,
            side: input.side,
            text: input.text,
          });
          return res.ok
            ? { ok: true, commentId: res.commentId }
            : { ok: false, error: res.error };
        },
        onDeleteComment: async (
          commentId: number,
        ): Promise<DeleteCommentResult> => {
          const res = await deleteReviewComment({
            owner: meta.owner,
            repo: meta.repo,
            prNumber: meta.prNumber,
            fetchNonce: meta.fetchNonce,
            commentId,
          });
          return res.ok ? { ok: true } : { ok: false, error: res.error };
        },
      };
    }

    document.addEventListener(MOUNT_TOOLBAR_EVENT, (e) => {
      const ev = e as CustomEvent<{ hostId: string }>;
      const detail = ev.detail;
      if (!detail || typeof detail.hostId !== 'string') return;
      const host = findHost(detail.hostId);
      if (!host) return;
      roots.get(detail.hostId)?.unmount();
      try {
        const m = mountToolbar(host);
        roots.set(detail.hostId, m);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          '[ghDiffs:main] mountToolbar failed for hostId',
          detail.hostId,
          err,
        );
      }
    });

    document.addEventListener(UNMOUNT_EVENT, (e) => {
      const ev = e as CustomEvent<{ hostId: string }>;
      const detail = ev.detail;
      if (!detail || typeof detail.hostId !== 'string') return;
      const r = roots.get(detail.hostId);
      if (!r) return;
      try {
        r.unmount();
      } catch {
        // ignore
      }
      roots.delete(detail.hostId);
    });

    // Race protection: the isolated content script may have loaded *before*
    // we attached our READY listener, in which case its initial dispatch of
    // POLL_EVENT was missed. We respond to every POLL by re-dispatching READY,
    // and we also dispatch READY once unconditionally on init.
    document.addEventListener(POLL_EVENT, () => {
      document.dispatchEvent(new CustomEvent(READY_EVENT));
    });
    document.dispatchEvent(new CustomEvent(READY_EVENT));
  },
});
