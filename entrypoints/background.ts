import { fetchDiff } from '@/lib/fetch-diff';
import { fetchRawFile } from '@/lib/fetch-raw-file';
import type { FetchDiffRequest, FetchRawFileRequest } from '@/lib/messages';

export default defineBackground(() => {
  console.log('[ghDiffs] background loaded');

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'fetchDiff') {
      const req = msg as FetchDiffRequest;
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 10_000);
      fetchDiff({
        owner: req.owner,
        repo: req.repo,
        prNumber: req.prNumber,
        signal: ac.signal,
      })
        .then(sendResponse)
        .finally(() => clearTimeout(timeout));
      return true; // keep the channel open for async response
    }
    if (msg?.type === 'fetchRawFile') {
      const req = msg as FetchRawFileRequest;
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), 10_000);
      fetchRawFile({
        owner: req.owner,
        repo: req.repo,
        sha: req.sha,
        path: req.path,
        signal: ac.signal,
      })
        .then(sendResponse)
        .finally(() => clearTimeout(timeout));
      return true;
    }
    return false;
  });
});
