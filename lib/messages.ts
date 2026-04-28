export type FetchDiffRequest = {
  type: 'fetchDiff';
  owner: string;
  repo: string;
  prNumber: number;
};

export type FetchDiffResponse =
  | { ok: true; patch: string }
  | { ok: false; error: string; status?: number };

export type FetchRawFileRequest = {
  type: 'fetchRawFile';
  owner: string;
  repo: string;
  sha: string;
  path: string;
};

export type FetchRawFileResponse =
  | { ok: true; content: string }
  | { ok: false; error: string; status?: number };
