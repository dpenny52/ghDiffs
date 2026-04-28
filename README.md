# ghDiffs

Chrome extension that replaces GitHub PR diffs with [`@pierre/diffs`](https://diffs.com).

Auto-runs on `github.com/*/pull/*/changes`. Fetches the PR's unified diff and the full base/head file contents using your existing GitHub session cookies (works on private repos — no OAuth or PAT). Renders each file with `<MultiFileDiff>` so the library's expand-context buttons work.

## Install

```bash
bun install
bun run build
```

Then in Chrome:
1. Open `chrome://extensions/`
2. Toggle **Developer mode**
3. **Load unpacked** → select `.output/chrome-mv3/`

Reload the extension after each `bun run build`.

## Use

Open any GitHub PR's "Files changed" tab. The native diff is replaced automatically.

Theme is set in `lib/render.tsx` (`SHARED_DIFF_OPTIONS`). Currently `ayu-dark` / `ayu-light` following OS color scheme. Any [Shiki theme](https://shiki.style/themes) plus `pierre-dark` / `pierre-light` work.

## Develop

```bash
bun run dev       # WXT dev server with HMR
bun run test      # vitest
bun run compile   # tsc --noEmit
bun run build     # production bundle
```

## Architecture

Two content scripts share the page DOM:

- `entrypoints/content.ts` — isolated world. Detects PR pages, reads base/head SHAs from the embedded `pullRequestsChangesRoute` JSON payload, sends `fetchDiff` + `fetchRawFile` messages to the service worker, dispatches `ghdiffs:mountFiles` CustomEvents.
- `entrypoints/main-world.content.ts` — main world. Imports `@pierre/diffs/react`, listens for the events, mounts `<MultiFileDiff>`. Lives in main world because Chrome MV3 isolated worlds have a `null` `customElements` registry.

`entrypoints/background.ts` is the service worker — does the actual `fetch()` calls so they bypass GitHub's page CSP and inherit the user's session cookies.

Build output forces ASCII-only JS via a Rollup plugin in `wxt.config.ts` because Chrome rejects content scripts containing U+FFFF noncharacters (used internally by Shiki's regex engine).
