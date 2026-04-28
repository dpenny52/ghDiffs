import { describe, it, expect } from 'vitest';
import { parsePrUrl } from './pr-url';

describe('parsePrUrl', () => {
  describe('valid PR URLs', () => {
    it('parses base PR URL with no view segment as conversation', () => {
      expect(parsePrUrl('https://github.com/senpilot/senpilot/pull/3354')).toEqual({
        owner: 'senpilot',
        repo: 'senpilot',
        prNumber: 3354,
        view: 'conversation',
      });
    });

    it('parses base PR URL with trailing slash as conversation', () => {
      expect(parsePrUrl('https://github.com/senpilot/senpilot/pull/3354/')).toEqual({
        owner: 'senpilot',
        repo: 'senpilot',
        prNumber: 3354,
        view: 'conversation',
      });
    });

    it('parses /files view', () => {
      expect(parsePrUrl('https://github.com/senpilot/senpilot/pull/3354/files')).toEqual({
        owner: 'senpilot',
        repo: 'senpilot',
        prNumber: 3354,
        view: 'files',
      });
    });

    it('parses /changes view as files (GitHub renamed /files → /changes)', () => {
      expect(parsePrUrl('https://github.com/senpilot/senpilot/pull/3354/changes')).toEqual({
        owner: 'senpilot',
        repo: 'senpilot',
        prNumber: 3354,
        view: 'files',
      });
    });

    it('ignores hash on /files view', () => {
      expect(parsePrUrl('https://github.com/senpilot/senpilot/pull/3354/files#diff-abc123')).toEqual({
        owner: 'senpilot',
        repo: 'senpilot',
        prNumber: 3354,
        view: 'files',
      });
    });

    it('ignores query on /files view', () => {
      expect(parsePrUrl('https://github.com/senpilot/senpilot/pull/3354/files?w=1')).toEqual({
        owner: 'senpilot',
        repo: 'senpilot',
        prNumber: 3354,
        view: 'files',
      });
    });

    it('ignores both query and hash', () => {
      expect(parsePrUrl('https://github.com/senpilot/senpilot/pull/3354/files?w=1#diff-abc')).toEqual({
        owner: 'senpilot',
        repo: 'senpilot',
        prNumber: 3354,
        view: 'files',
      });
    });

    it('parses /commits view', () => {
      expect(parsePrUrl('https://github.com/senpilot/senpilot/pull/3354/commits')).toEqual({
        owner: 'senpilot',
        repo: 'senpilot',
        prNumber: 3354,
        view: 'commits',
      });
    });

    it('parses /checks view', () => {
      expect(parsePrUrl('https://github.com/senpilot/senpilot/pull/3354/checks')).toEqual({
        owner: 'senpilot',
        repo: 'senpilot',
        prNumber: 3354,
        view: 'checks',
      });
    });

    it('classifies unknown trailing segments as other', () => {
      expect(parsePrUrl('https://github.com/senpilot/senpilot/pull/3354/anything-else')).toEqual({
        owner: 'senpilot',
        repo: 'senpilot',
        prNumber: 3354,
        view: 'other',
      });
    });

    it('handles owners with hyphens', () => {
      expect(parsePrUrl('https://github.com/my-org/my-repo/pull/42')).toEqual({
        owner: 'my-org',
        repo: 'my-repo',
        prNumber: 42,
        view: 'conversation',
      });
    });

    it('handles repos with dots', () => {
      expect(parsePrUrl('https://github.com/foo/repo.js/pull/7')).toEqual({
        owner: 'foo',
        repo: 'repo.js',
        prNumber: 7,
        view: 'conversation',
      });
    });

    it('handles owners and repos with underscores', () => {
      expect(parsePrUrl('https://github.com/under_score/under_score/pull/1')).toEqual({
        owner: 'under_score',
        repo: 'under_score',
        prNumber: 1,
        view: 'conversation',
      });
    });

    it('returns prNumber as a number, not a string', () => {
      const result = parsePrUrl('https://github.com/senpilot/senpilot/pull/3354');
      expect(result?.prNumber).toBe(3354);
      expect(typeof result?.prNumber).toBe('number');
    });
  });

  describe('invalid URLs return null', () => {
    it('returns null for /pulls (list, plural)', () => {
      expect(parsePrUrl('https://github.com/owner/repo/pulls')).toBeNull();
    });

    it('returns null for repo root', () => {
      expect(parsePrUrl('https://github.com/owner/repo')).toBeNull();
    });

    it('returns null for non-github.com hosts', () => {
      expect(parsePrUrl('https://gitlab.com/foo/bar/pull/1')).toBeNull();
    });

    it('returns null for github subdomains', () => {
      expect(parsePrUrl('https://gist.github.com/foo/bar/pull/1')).toBeNull();
    });

    it('returns null for invalid URL strings', () => {
      expect(parsePrUrl('not a url')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parsePrUrl('')).toBeNull();
    });

    it('returns null when PR number is not numeric', () => {
      expect(parsePrUrl('https://github.com/owner/repo/pull/abc')).toBeNull();
    });

    it('returns null when missing pr number', () => {
      expect(parsePrUrl('https://github.com/owner/repo/pull')).toBeNull();
    });

    it('returns null for github.com root', () => {
      expect(parsePrUrl('https://github.com/')).toBeNull();
    });

    it('does not throw on garbage input', () => {
      expect(() => parsePrUrl('http://')).not.toThrow();
      expect(() => parsePrUrl('://')).not.toThrow();
      expect(() => parsePrUrl('javascript:alert(1)')).not.toThrow();
    });

    it('returns null for issues path', () => {
      expect(parsePrUrl('https://github.com/owner/repo/issues/1')).toBeNull();
    });
  });
});
