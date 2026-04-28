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

export type ReviewCommentSide = 'right' | 'left';

export type PostReviewCommentRequest = {
  type: 'postReviewComment';
  owner: string;
  repo: string;
  prNumber: number;
  baseOid: string;
  headOid: string;
  fetchNonce: string;
  path: string;
  line: number;
  side: ReviewCommentSide;
  text: string;
};

export type PostReviewCommentResponse =
  | { ok: true; commentId: number }
  | { ok: false; error: string; status?: number };

export type DeleteReviewCommentRequest = {
  type: 'deleteReviewComment';
  owner: string;
  repo: string;
  prNumber: number;
  fetchNonce: string;
  commentId: number;
};

export type DeleteReviewCommentResponse =
  | { ok: true }
  | { ok: false; error: string; status?: number };
