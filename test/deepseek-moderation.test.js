import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTextWithDeepSeek } from '../server/deepseek-moderation.js';

function response(decision, category = 'none') {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ decision, category }) } }] })
  };
}

test('DeepSeek moderation sends compact JSON-only classification requests', async () => {
  let request;
  const result = await inspectTextWithDeepSeek('نص عربي', {
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response('allow');
    }
  });

  assert.deepEqual(result, { decision: 'allow', category: 'none' });
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'deepseek-chat');
  assert.equal(body.max_tokens, 80);
  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('DeepSeek moderation caches decisions without storing submitted text', async () => {
  const entries = new Map();
  const cache = {
    get: async key => entries.get(key),
    set: async (key, value, _expiry, seconds) => {
      assert.equal(seconds, 86400);
      entries.set(key, value);
    }
  };
  let requests = 0;
  const options = {
    apiKey: 'test-key',
    cache,
    fetchImpl: async () => {
      requests += 1;
      return response('reject', 'sexual_content');
    }
  };

  assert.deepEqual(await inspectTextWithDeepSeek('نص متكرر', options), { decision: 'reject', category: 'sexual_content' });
  assert.deepEqual(await inspectTextWithDeepSeek('نص متكرر', options), { decision: 'reject', category: 'sexual_content' });
  assert.equal(requests, 1);
  assert.ok([...entries.keys()][0].startsWith('nexa:moderation:deepseek:'));
  assert.doesNotMatch([...entries.keys()][0], /نص متكرر/u);
});

test('empty captions do not require DeepSeek or spend moderation credits', async () => {
  assert.deepEqual(await inspectTextWithDeepSeek('   ', { apiKey: '', fetchImpl: async () => assert.fail('empty text must not call DeepSeek') }), {
    decision: 'allow',
    category: 'none'
  });
});

test('DeepSeek moderation fails closed when unconfigured or unavailable', async () => {
  await assert.rejects(
    inspectTextWithDeepSeek('نص', { apiKey: '', fetchImpl: async () => response('allow') }),
    error => error.code === 'DEEPSEEK_NOT_CONFIGURED'
  );
  await assert.rejects(
    inspectTextWithDeepSeek('نص', { apiKey: 'test-key', fetchImpl: async () => ({ ok: false }) }),
    error => error.code === 'AI_MODERATION_UNAVAILABLE'
  );
});

test('DeepSeek moderation rejects invalid model output and oversized text', async () => {
  await assert.rejects(
    inspectTextWithDeepSeek('نص', {
      apiKey: 'test-key',
      fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"decision":"allow","category":"unknown"}' } }] }) })
    }),
    error => error.code === 'AI_MODERATION_UNAVAILABLE'
  );
  await assert.rejects(
    inspectTextWithDeepSeek('x'.repeat(5001), { apiKey: 'test-key' }),
    error => error.code === 'CONTENT_TOO_LONG'
  );
});
