// MAIN-world content script.
//
// MV3 content scripts default to the "isolated" world, which has its own JS
// global where `customElements` is `null`. `@pierre/diffs` synchronously calls
// `customElements.get('diffs-container')` at module-load time and crashes in
// the isolated world. Running in MAIN gives us the page's real custom-element
// registry, so the import succeeds.
//
// This script is purely a passive event consumer: it receives mount/unmount
// events from the isolated content script and renders <PatchDiff /> /
// <MultiFileDiff /> into the host element identified by
// `data-ghdiffs-host-id`.

type Mounted = { unmount: () => void };

type MountFilesDetail = {
  hostId: string;
  oldFile: { name: string; contents: string };
  newFile: { name: string; contents: string };
};

export default defineContentScript({
  matches: ['https://github.com/*/pull/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  async main() {
    // Lazy-import so any module-level customElements code in @pierre/diffs
    // executes in the MAIN world (where customElements actually exists).
    const { mountPatchDiff, mountMultiFile } = await import('@/lib/render');

    const roots = new Map<string, Mounted>();

    const READY_EVENT = 'ghdiffs:main-ready';
    const POLL_EVENT = 'ghdiffs:isolated-poll';
    const MOUNT_EVENT = 'ghdiffs:mount';
    const MOUNT_FILES_EVENT = 'ghdiffs:mountFiles';
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
      // Idempotent: if a previous mount exists for this id, tear it down first.
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
      try {
        const m = mountMultiFile(host, detail.oldFile, detail.newFile);
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
