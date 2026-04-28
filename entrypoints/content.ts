import { readFetchNonce } from '@/lib/csrf';
import {
  readExistingThreads,
  type ExistingThread,
  type ExistingThreadsByPath,
} from '@/lib/existing-comments';
import {
  findAllFileContainers,
  findFileListParent,
  getDiffBody,
  getFilePath,
} from '@/lib/github-dom';
import type {
  FetchDiffRequest,
  FetchDiffResponse,
  FetchRawFileRequest,
  FetchRawFileResponse,
} from '@/lib/messages';
import { parsePrUrl } from '@/lib/pr-url';
import { splitUnifiedDiff, type SplitFile } from '@/lib/split-patch';

export default defineContentScript({
  matches: ['https://github.com/*/pull/*'],
  async main() {
    // This script lives in the isolated world. `@pierre/diffs` and React DOM
    // mount in the MAIN world (see `entrypoints/main-world.ts`); we hand the
    // patch text and the host element id off via CustomEvents on `document`.
    type Mount = {
      hostId: string;
      // The host <div> we inserted as a sibling of the diff body.
      host: HTMLElement;
      // The original diff body whose `display` we hid.
      hiddenBody: HTMLElement;
      // Saved inline display value (so teardown can restore it).
      previousDisplay: string;
    };

    const mounts = new Map<HTMLElement, Mount>();
    let observer: MutationObserver | null = null;
    // Per-PR cache of split-by-file patches; keyed by `${owner}/${repo}#${prNumber}`.
    let perFilePatches: Map<string, SplitFile> | null = null;
    // Base/head commit SHAs for the active PR (when available). When null, we
    // fall back to the patch-only path with no expand-context buttons.
    let comparisonOids: { baseOid: string; headOid: string } | null = null;
    // Pre-existing review threads keyed by file path, parsed from the embedded
    // pullRequestsChangesRoute JSON. Null until the payload is read on start.
    let existingThreadsByPath: ExistingThreadsByPath | null = null;
    let activeKey: string | null = null;
    let hostIdCounter = 0;

    const PROCESSED_ATTR = 'data-ghdiffs-mounted';
    const HOST_CLASS = 'ghdiffs-host';
    const HOST_ID_ATTR = 'data-ghdiffs-host-id';

    const READY_EVENT = 'ghdiffs:main-ready';
    const POLL_EVENT = 'ghdiffs:isolated-poll';
    const MOUNT_EVENT = 'ghdiffs:mount';
    const MOUNT_FILES_EVENT = 'ghdiffs:mountFiles';
    const UNMOUNT_EVENT = 'ghdiffs:unmount';

    const SHA_RE = /^[0-9a-f]{40}$/;
    const BINARY_DIFF_RE = /^Binary files .* differ$/m;

    // ---- Main-world readiness handshake ------------------------------------
    let mainReady = false;
    let mainReadyResolvers: Array<() => void> = [];

    function resolveMainReady() {
      if (mainReady) return;
      mainReady = true;
      const resolvers = mainReadyResolvers;
      mainReadyResolvers = [];
      for (const r of resolvers) r();
    }

    function ensureMainReady(): Promise<void> {
      if (mainReady) return Promise.resolve();
      return new Promise<void>((resolve) => {
        mainReadyResolvers.push(resolve);
      });
    }

    document.addEventListener(READY_EVENT, () => {
      resolveMainReady();
    });
    // If the main-world script loaded first and already dispatched its
    // READY before our listener was attached, ask it to dispatch again.
    document.dispatchEvent(new CustomEvent(POLL_EVENT));

    // ---- DOM / patch helpers -----------------------------------------------
    function shouldRunOnUrl(url: string): { run: boolean; key: string | null } {
      const parsed = parsePrUrl(url);
      if (!parsed) return { run: false, key: null };
      if (parsed.view !== 'files') return { run: false, key: null };
      const key = `${parsed.owner}/${parsed.repo}#${parsed.prNumber}`;
      return { run: true, key };
    }

    function indexPatches(patch: string): Map<string, SplitFile> {
      const split = splitUnifiedDiff(patch);
      const idx = new Map<string, SplitFile>();
      for (const f of split) {
        if (f.newPath && f.newPath !== '/dev/null') idx.set(f.newPath, f);
        if (f.oldPath && f.oldPath !== '/dev/null' && !idx.has(f.oldPath)) {
          idx.set(f.oldPath, f);
        }
      }
      return idx;
    }

    function lookupSplitFile(
      idx: Map<string, SplitFile>,
      domPath: string,
    ): SplitFile | null {
      return idx.get(domPath) ?? null;
    }

    // GitHub embeds a JSON payload on the /changes page that contains the
    // base/head commit SHAs. Without these we can't fetch full file contents,
    // so the caller falls back to patch-only rendering.
    function readPrComparisonOids(): {
      baseOid: string;
      headOid: string;
    } | null {
      try {
        const scripts = document.scripts;
        for (let i = 0; i < scripts.length; i++) {
          const s = scripts[i];
          const text = s.textContent ?? '';
          if (!text || !text.includes('"pullRequestsChangesRoute"')) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            continue;
          }
          const fullDiff = (parsed as {
            payload?: {
              pullRequestsChangesRoute?: {
                comparison?: {
                  fullDiff?: { baseOid?: unknown; headOid?: unknown };
                };
              };
            };
          })?.payload?.pullRequestsChangesRoute?.comparison?.fullDiff;
          if (!fullDiff) continue;
          const baseOid =
            typeof fullDiff.baseOid === 'string' ? fullDiff.baseOid : '';
          const headOid =
            typeof fullDiff.headOid === 'string' ? fullDiff.headOid : '';
          if (SHA_RE.test(baseOid) && SHA_RE.test(headOid)) {
            return { baseOid, headOid };
          }
        }
      } catch {
        // fall through
      }
      return null;
    }

    function isAlreadyMounted(container: HTMLElement): boolean {
      return container.getAttribute(PROCESSED_ATTR) === '1';
    }

    function markMounted(container: HTMLElement) {
      container.setAttribute(PROCESSED_ATTR, '1');
    }

    function unmarkMounted(container: HTMLElement) {
      container.removeAttribute(PROCESSED_ATTR);
    }

    function nextHostId(): string {
      hostIdCounter += 1;
      return `gh-diff-${hostIdCounter}`;
    }

    function dispatchMountPatch(hostId: string, patch: string) {
      // Wait for the main-world script to be alive before dispatching the
      // first mount. Subsequent mounts go through immediately.
      void ensureMainReady().then(() => {
        document.dispatchEvent(
          new CustomEvent(MOUNT_EVENT, { detail: { hostId, patch } }),
        );
      });
    }

    function dispatchMountFiles(
      hostId: string,
      oldFile: { name: string; contents: string },
      newFile: { name: string; contents: string },
      comments?: {
        owner: string;
        repo: string;
        prNumber: number;
        baseOid: string;
        headOid: string;
        fetchNonce: string;
      },
      existingThreads?: ExistingThread[],
    ) {
      void ensureMainReady().then(() => {
        document.dispatchEvent(
          new CustomEvent(MOUNT_FILES_EVENT, {
            detail: { hostId, oldFile, newFile, comments, existingThreads },
          }),
        );
      });
    }

    function dispatchUnmount(hostId: string) {
      // Best-effort. If main-world isn't ready yet, the unmount target has
      // never been mounted, so dropping the event is safe.
      document.dispatchEvent(
        new CustomEvent(UNMOUNT_EVENT, { detail: { hostId } }),
      );
    }

    async function fetchRawFileOnce(
      owner: string,
      repo: string,
      sha: string,
      path: string,
    ): Promise<string | null> {
      const req: FetchRawFileRequest = {
        type: 'fetchRawFile',
        owner,
        repo,
        sha,
        path,
      };
      let res: FetchRawFileResponse;
      try {
        res = (await chrome.runtime.sendMessage(req)) as FetchRawFileResponse;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ghDiffs] sendMessage(fetchRawFile) failed', err);
        return null;
      }
      if (!res || !res.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          '[ghDiffs] fetchRawFile failed',
          path,
          res && 'error' in res ? res.error : 'no response',
        );
        return null;
      }
      return res.content;
    }

    function tryMountOne(container: HTMLElement) {
      if (isAlreadyMounted(container)) return;
      if (!perFilePatches) return;

      const path = getFilePath(container);
      if (!path) return;

      const splitFile = lookupSplitFile(perFilePatches, path);
      if (!splitFile) return;

      // Skip binary files entirely — leave GitHub's native rendering for them.
      if (BINARY_DIFF_RE.test(splitFile.patch)) {
        markMounted(container);
        return;
      }

      const body = getDiffBody(container);
      if (!body) return;

      // Hide the original diff body. Preserve its previous inline display so
      // teardown restores exactly what was there.
      const previousDisplay = body.style.display;
      body.style.display = 'none';

      // Insert our host as a sibling immediately after the diff body so the
      // file header / view button / etc. above remain untouched.
      const hostId = nextHostId();
      const host = document.createElement('div');
      host.className = HOST_CLASS;
      host.setAttribute(HOST_ID_ATTR, hostId);
      body.insertAdjacentElement('afterend', host);

      mounts.set(container, {
        hostId,
        host,
        hiddenBody: body,
        previousDisplay,
      });
      markMounted(container);

      // Capture the active key so we can bail out of late completions if the
      // user navigates to another PR while fetches are in flight.
      const startedKey = activeKey;

      // If we don't have SHAs, fall back to the patch-only path.
      if (!comparisonOids) {
        dispatchMountPatch(hostId, splitFile.patch);
        return;
      }

      const parsed = parsePrUrl(location.href);
      const owner = parsed?.owner ?? '';
      const repo = parsed?.repo ?? '';
      const prNumber = parsed?.prNumber ?? 0;
      if (!owner || !repo || !prNumber) {
        dispatchMountPatch(hostId, splitFile.patch);
        return;
      }

      const { baseOid, headOid } = comparisonOids;
      const isAdded = splitFile.oldPath === '/dev/null';
      const isDeleted = splitFile.newPath === '/dev/null';

      const baseTask: Promise<string | null> = isAdded
        ? Promise.resolve('')
        : fetchRawFileOnce(owner, repo, baseOid, splitFile.oldPath);
      const headTask: Promise<string | null> = isDeleted
        ? Promise.resolve('')
        : fetchRawFileOnce(owner, repo, headOid, splitFile.newPath);

      void Promise.all([baseTask, headTask]).then(([baseContent, headContent]) => {
        // If the user navigated away (or this container was already torn down)
        // skip the dispatch.
        if (activeKey !== startedKey) return;
        if (!mounts.has(container)) return;

        if (baseContent === null || headContent === null) {
          // Fetch failed. Fall back to patch-only for this file.
          dispatchMountPatch(hostId, splitFile.patch);
          return;
        }

        const oldName = isAdded ? splitFile.newPath : splitFile.oldPath;
        const newName = isDeleted ? splitFile.oldPath : splitFile.newPath;
        // If we have a fetch nonce in the page, enable the comment UI by
        // shipping post/delete metadata along with the mount event. Without
        // a nonce GitHub's /page_data endpoints reject the request, so we
        // skip wiring the comment UI rather than show buttons that fail.
        const nonce = readFetchNonce();
        const comments = nonce
          ? {
              owner,
              repo,
              prNumber,
              baseOid,
              headOid,
              fetchNonce: nonce,
            }
          : undefined;
        // Look up pre-existing review threads for this file. We index by the
        // new path first (the path GitHub renders); for renames the threads
        // live under the new path. Falling back to the old path covers
        // delete-only diffs where the new path is /dev/null.
        const existing =
          existingThreadsByPath?.get(newName) ??
          existingThreadsByPath?.get(oldName);
        dispatchMountFiles(
          hostId,
          { name: oldName, contents: baseContent },
          { name: newName, contents: headContent },
          comments,
          existing,
        );
      });
    }

    function unmountOne(container: HTMLElement) {
      const m = mounts.get(container);
      if (!m) return;
      mounts.delete(container);
      dispatchUnmount(m.hostId);
      m.host.remove();
      m.hiddenBody.style.display = m.previousDisplay;
      unmarkMounted(container);
    }

    function processAllVisible() {
      for (const c of findAllFileContainers()) {
        tryMountOne(c);
      }
    }

    function attachObserver() {
      if (observer) return;
      const parent = findFileListParent();
      if (!parent) return;
      observer = new MutationObserver(() => {
        // GitHub progressively appends file entries as the user scrolls.
        // We don't bother filtering mutations — `processAllVisible` is
        // idempotent via the `data-ghdiffs-mounted` attribute.
        processAllVisible();
      });
      observer.observe(parent, { childList: true, subtree: true });
    }

    function detachObserver() {
      if (!observer) return;
      observer.disconnect();
      observer = null;
    }

    async function fetchPatchOnce(
      owner: string,
      repo: string,
      prNumber: number,
    ): Promise<string | null> {
      const req: FetchDiffRequest = {
        type: 'fetchDiff',
        owner,
        repo,
        prNumber,
      };
      let res: FetchDiffResponse;
      try {
        res = (await chrome.runtime.sendMessage(req)) as FetchDiffResponse;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[ghDiffs] sendMessage failed', err);
        return null;
      }
      if (!res || !res.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          '[ghDiffs] fetchDiff failed',
          res && 'error' in res ? res.error : 'no response',
        );
        return null;
      }
      return res.patch;
    }

    async function start(key: string) {
      if (activeKey === key) {
        // Same PR. If we're still mid-fetch, the existing inflight will
        // attach the observer + mount. If we already have patches, just
        // (re)scan and (re)attach in case the DOM was rebuilt.
        if (perFilePatches) {
          attachObserver();
          processAllVisible();
        }
        return;
      }
      // New PR / fresh start.
      teardown();
      activeKey = key;

      const parsed = parsePrUrl(location.href);
      const owner = parsed?.owner;
      const repo = parsed?.repo;
      const prNumber = parsed?.prNumber;
      if (!owner || !repo || !prNumber) return;

      const patch = await fetchPatchOnce(owner, repo, prNumber);
      // Bail if the user navigated away while we were fetching.
      if (activeKey !== key) return;
      if (!patch) return;
      perFilePatches = indexPatches(patch);
      comparisonOids = readPrComparisonOids();
      if (!comparisonOids) {
        // eslint-disable-next-line no-console
        console.warn(
          '[ghDiffs] could not read base/head SHAs — falling back to patch-only rendering (no expand-context buttons)',
        );
      }
      existingThreadsByPath = readExistingThreads();
      attachObserver();
      processAllVisible();
    }

    function teardown() {
      detachObserver();
      // Snapshot keys; unmountOne mutates the map.
      for (const container of Array.from(mounts.keys())) {
        unmountOne(container);
      }
      perFilePatches = null;
      comparisonOids = null;
      existingThreadsByPath = null;
      activeKey = null;
    }

    function reconcileToCurrentUrl() {
      const { run, key } = shouldRunOnUrl(location.href);
      if (!run || !key) {
        teardown();
        return;
      }
      // Fire-and-forget; errors are logged inside.
      void start(key);
    }

    // Boot.
    reconcileToCurrentUrl();

    // Turbo soft-nav: re-evaluate URL on every navigation.
    document.addEventListener('turbo:load', () => {
      reconcileToCurrentUrl();
    });

    // Best-effort: tear down React roots before Turbo swaps the document.
    // If the next page is also a /changes view, `turbo:load` will re-run
    // start() right after.
    document.addEventListener('turbo:visit', () => {
      teardown();
    });

    // Tear down on full unload too, just in case (Chrome generally does this
    // for us by destroying the content-script context).
    window.addEventListener('pagehide', () => {
      teardown();
    });
  },
});
