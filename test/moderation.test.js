import test from 'node:test';
import assert from 'node:assert/strict';
import { contentCheck, linkCheck, normalizeAllowedHost } from '../server/moderation.js';

test('moderation rejects configured abusive terms as separate words', () => {
  assert.equal(contentCheck('هذا shit كلام'), 'CONTENT_REJECTED');
  assert.equal(contentCheck('نص عادي ومحترم'), null);
  assert.equal(contentCheck('الزبدة في الموضوع'), null);
});

test('moderation normalizes Arabic marks and punctuation obfuscation', () => {
  assert.equal(contentCheck('كـسـم'), 'CONTENT_REJECTED');
  assert.equal(contentCheck('f.u.c.k'), 'CONTENT_REJECTED');
});

test('moderation accepts additional terms from server configuration', () => {
  const previous = process.env.CONTENT_BLOCKLIST;
  process.env.CONTENT_BLOCKLIST = 'ممنوع';
  try {
    assert.equal(contentCheck('هذا ممنوع هنا'), 'CONTENT_REJECTED');
  } finally {
    if (previous === undefined) delete process.env.CONTENT_BLOCKLIST;
    else process.env.CONTENT_BLOCKLIST = previous;
  }
});

test('external links are denied unless their host is allowlisted', () => {
  assert.equal(linkCheck('زيارة https://example.com/path'), 'LINK_NOT_ALLOWED');
  assert.equal(linkCheck('زيارة https://example.com/path', ['example.com']), null);
  assert.equal(linkCheck('زيارة https://sub.example.com/path', ['example.com']), null);
  assert.equal(linkCheck('زيارة https://notexample.com', ['example.com']), 'LINK_NOT_ALLOWED');
});

test('link checks normalize common obfuscation and reject unsafe schemes', () => {
  assert.equal(linkCheck('hxxps://evil[.]example'), 'LINK_NOT_ALLOWED');
  assert.equal(linkCheck('evil dot example'), 'LINK_NOT_ALLOWED');
  assert.equal(linkCheck('evil . com'), 'LINK_NOT_ALLOWED');
  assert.equal(linkCheck('http://127.0.0.1'), 'LINK_NOT_ALLOWED');
  assert.equal(linkCheck('Hello. This is an ordinary sentence.'), null);
  assert.equal(linkCheck('javascript:alert(1)', ['example.com']), 'LINK_NOT_ALLOWED');
  assert.equal(normalizeAllowedHost('ExAmPlE.com.'), 'example.com');
  assert.equal(normalizeAllowedHost('https://example.com'), null);
});