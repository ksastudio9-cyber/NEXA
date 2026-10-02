import test from 'node:test';
import assert from 'node:assert/strict';
import { localModerationCheck } from '../src/offline-store.js';

test('offline moderation rejects configured baseline terms', () => {
  assert.equal(localModerationCheck('هذا shit كلام'), 'CONTENT_REJECTED');
  assert.equal(localModerationCheck('كـسـم'), 'CONTENT_REJECTED');
});

test('offline moderation allows ordinary text', () => {
  assert.equal(localModerationCheck('رسالة عادية لصديق'), null);
});