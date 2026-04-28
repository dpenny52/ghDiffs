import { describe, expect, it } from 'vitest';
import { parseThreadsFromPayload } from './existing-comments';

function payloadWithThreads() {
  return {
    payload: {
      pullRequestsChangesRoute: {
        diffSummaries: [
          {
            path: 'src/foo.ts',
            markersMap: {
              R36: {
                threads: [{ id: 100 }],
                annotations: [],
                ctx: [33, 39],
              },
              L20: {
                threads: [{ id: 101 }],
              },
            },
          },
          {
            path: 'src/bar.ts',
            markersMap: {
              R5: {
                threads: [{ id: 102 }, { id: 103 }],
              },
              R7: {
                threads: [{ id: 999 }], // missing in markers.threads — drop silently
              },
            },
          },
          {
            path: 'src/empty.ts',
            markersMap: {},
          },
        ],
        markers: {
          threads: {
            '100': {
              id: '100',
              isResolved: false,
              commentsData: {
                comments: [
                  {
                    databaseId: 5001,
                    body: 'first',
                    bodyHTML: '<p>first</p>',
                    author: {
                      login: 'alice',
                      avatarUrl: 'https://example.com/alice.png',
                    },
                    viewerCanDelete: true,
                  },
                  {
                    databaseId: 5002,
                    body: 'reply',
                    author: { login: 'bob' },
                    viewerCanDelete: false,
                  },
                ],
              },
            },
            '101': {
              isResolved: true,
              commentsData: {
                comments: [
                  {
                    databaseId: '5003',
                    body: 'on the left',
                    author: { login: 'carol' },
                    viewerCanDelete: false,
                  },
                ],
              },
            },
            '102': {
              isResolved: false,
              commentsData: {
                comments: [
                  {
                    databaseId: 6001,
                    body: 'thread one',
                    author: null,
                    viewerCanDelete: true,
                  },
                ],
              },
            },
            '103': {
              isResolved: false,
              commentsData: {
                comments: [
                  {
                    databaseId: 6002,
                    body: 'thread two',
                    author: { login: 'dave' },
                    viewerCanDelete: false,
                  },
                ],
              },
            },
          },
        },
      },
    },
  };
}

describe('parseThreadsFromPayload', () => {
  it('groups threads by file path and parses side/line from marker keys', () => {
    const result = parseThreadsFromPayload(payloadWithThreads());
    expect(result).not.toBeNull();
    const byPath = result!;
    expect(byPath.has('src/foo.ts')).toBe(true);
    expect(byPath.has('src/bar.ts')).toBe(true);
    expect(byPath.has('src/empty.ts')).toBe(false);

    const foo = byPath.get('src/foo.ts')!;
    const r36 = foo.find((t) => t.line === 36)!;
    expect(r36.side).toBe('right');
    expect(r36.comments).toEqual([
      {
        id: 5001,
        body: 'first',
        bodyHTML: '<p>first</p>',
        author: 'alice',
        avatarUrl: 'https://example.com/alice.png',
        canDelete: true,
      },
      {
        id: 5002,
        body: 'reply',
        bodyHTML: '',
        author: 'bob',
        avatarUrl: null,
        canDelete: false,
      },
    ]);

    const l20 = foo.find((t) => t.line === 20)!;
    expect(l20.side).toBe('left');
    expect(l20.isResolved).toBe(true);
    expect(l20.comments[0].id).toBe(5003); // string databaseId coerced to number
  });

  it('merges multiple threads on the same line into a single thread group', () => {
    const result = parseThreadsFromPayload(payloadWithThreads())!;
    const bar = result.get('src/bar.ts')!;
    const r5 = bar.find((t) => t.line === 5)!;
    expect(r5.comments.map((c) => c.id)).toEqual([6001, 6002]);
  });

  it('drops marker entries that reference unknown thread ids', () => {
    const result = parseThreadsFromPayload(payloadWithThreads())!;
    const bar = result.get('src/bar.ts')!;
    expect(bar.find((t) => t.line === 7)).toBeUndefined();
  });

  it('returns null when the payload shape is not recognised', () => {
    expect(parseThreadsFromPayload(null)).toBeNull();
    expect(parseThreadsFromPayload({})).toBeNull();
    expect(parseThreadsFromPayload({ payload: {} })).toBeNull();
    expect(
      parseThreadsFromPayload({ payload: { pullRequestsChangesRoute: {} } }),
    ).toBeNull();
  });

  it('skips marker keys that do not match the L<n>/R<n> pattern', () => {
    const payload = {
      payload: {
        pullRequestsChangesRoute: {
          diffSummaries: [
            {
              path: 'a.ts',
              markersMap: {
                'X12': { threads: [{ id: 1 }] },
                'R-3': { threads: [{ id: 1 }] },
                'R0': { threads: [{ id: 1 }] },
              },
            },
          ],
          markers: {
            threads: {
              '1': {
                commentsData: { comments: [{ databaseId: 1, body: 'c' }] },
              },
            },
          },
        },
      },
    };
    expect(parseThreadsFromPayload(payload)).toEqual(new Map());
  });
});
