import { afterEach, describe, expect, it } from 'vitest';
import { readFetchNonce } from './csrf';

afterEach(() => {
  document.head
    .querySelectorAll('meta[name="fetch-nonce"]')
    .forEach((m) => m.remove());
});

function setMeta(content: string | null) {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'fetch-nonce');
  if (content !== null) meta.setAttribute('content', content);
  document.head.appendChild(meta);
}

describe('readFetchNonce', () => {
  it('returns the nonce when the meta tag is present', () => {
    setMeta('v2:abc123-deadbeef');
    expect(readFetchNonce()).toBe('v2:abc123-deadbeef');
  });

  it('returns null when the meta tag is missing', () => {
    expect(readFetchNonce()).toBeNull();
  });

  it('returns null when the content attribute is empty', () => {
    setMeta('');
    expect(readFetchNonce()).toBeNull();
  });

  it('returns null when the content attribute is missing', () => {
    setMeta(null);
    expect(readFetchNonce()).toBeNull();
  });

  it('reads from a custom root element', () => {
    const root = document.createElement('div');
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'fetch-nonce');
    meta.setAttribute('content', 'scoped-nonce');
    root.appendChild(meta);
    expect(readFetchNonce(root)).toBe('scoped-nonce');
  });
});
