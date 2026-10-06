const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');
const { run, contract, error } = require('./page-route-entry-compat.test.cjs');

for (const operation of ['create', 'patch', 'restore']) {
  test(`${operation}: ON and OFF preserve malformed/empty/non-object JSON bytes without business effects`, async () => {
    for (const mode of ['ON', 'OFF']) {
      for (const raw of ['', '{', '{"task_id":,}', 'null', 'true', 'false', '1', '"50"', '[]', '[{}]']) {
        const result = await run(operation, mode, { raw });
        error(result, 400, ['', '{', '{"task_id":,}'].includes(raw) ? 'Request body must be valid JSON' : 'Request body must be a JSON object');
        assert.deepEqual(result.calls, [['json', null]]);
      }
    }
  });
  test(`${operation}: empty object preserves original first field validation`, async () => {
    for (const mode of ['ON', 'OFF']) {
      const result = await run(operation, mode, { raw: '{}' });
      error(result, 400, { create: 'task_id must be a positive integer', patch: 'title or content must be provided', restore: 'version_id must be a positive integer' }[operation]);
      assert.deepEqual(result.calls, [['json', null]]);
    }
  });
  test(`${operation}: shared reader is invoked only ON with route-specific callbacks`, async () => {
    const reader = load('src/lib/mcp/readJsonBody.ts', {});
    for (const mode of ['ON', 'OFF', 'FLAG_FAILURE', 'USER_FAILURE', 'NO_SESSION']) {
      let readCount = 0;
      const mocks = { '@/lib/mcp/readJsonBody': { readJsonBody: async (request, callbacks) => {
        readCount++;
        assert.equal(typeof callbacks.invalidJson, 'function');
        assert.equal(typeof callbacks.invalidObject, 'function');
        return reader.readJsonBody(request, callbacks);
      } } };
      const result = await run(operation, mode, { mocks });
      assert.equal(readCount, mode === 'ON' ? 1 : 0);
      assert.deepEqual(contract(result), contract(await run(operation, 'OFF')));
    }
  });
}
