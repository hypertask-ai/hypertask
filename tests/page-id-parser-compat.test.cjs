const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');
const { run, contract, error } = require('./page-route-entry-compat.test.cjs');

const bodyValues = [
  [1, true], [50, true], [Number.MAX_SAFE_INTEGER, true], [Number.MAX_SAFE_INTEGER + 1, true],
  [1e30, true], [0, false], [-1, false], [1.5, false], [Infinity, false], [NaN, false],
  ['50', false], ['050', false], [' 50', false], ['50x', false], ['5e1', false],
  [null, false], [[], false], [{}, false], [true, false], [undefined, false],
];
const fields = [
  ['create', 'task_id', { content: 'text' }, 'task', (args) => args.where.id],
  ['create', 'parent_page_id', { task_id: 50, content: 'text' }, 'create', (args) => args.parentPageId],
  ['patch', 'if_version', { content: 'text' }, 'update', (args) => args.ifVersion],
  ['restore', 'version_id', {}, 'restore', (args) => args.versionId],
];
for (const [operation, field, body, service, readId] of fields) {
  test(`${operation} ${field}: both modes retain numeric-only, unsafe-integer-compatible predicates`, async () => {
    for (const mode of ['ON', 'OFF']) for (const [value, valid] of bodyValues) {
      const result = await run(operation, mode, { body: { ...body, [field]: value } });
      const optionalMissing = value === undefined && ['parent_page_id', 'if_version'].includes(field);
      if (valid || optionalMissing) {
        assert.equal(result.status, 200, `${mode}/${field}/${String(value)}`);
        assert.equal(readId(result.calls.find(([name]) => name === service)[1]), value);
      } else {
        error(result, 400, `${field} must be a positive integer`);
        assert.deepEqual(result.calls, [['json', null]]);
      }
    }
  });
}
test('list task_id: both modes retain strict safe digit strings, leading zeros and missing-ID responses', async () => {
  for (const mode of ['ON', 'OFF']) for (const [value, valid] of [
    ['50', true], ['0050', true], ['9007199254740991', true],
    ['9007199254740992', false], ['1e30', false], ['0', false], ['-1', false],
    ['1.5', false], ['+50', false], [' 50', false], ['50 ', false], ['50x', false],
    ['', false], ['Infinity', false], ['NaN', false], [null, false],
  ]) {
    const result = await run('list', mode, { query: { task_id: value } });
    if (valid) {
      assert.equal(result.status, 200);
      assert.equal(result.calls.find(([name]) => name === 'task')[1].where.id, Number(value));
    } else {
      error(result, 400, 'task_id must be a positive integer');
      assert.deepEqual(result.calls, []);
    }
  }
});
test('title-only PATCH keeps invalid if_version/content_type/mode/note ignored in both modes', async () => {
  for (const mode of ['ON', 'OFF']) for (const [value] of bodyValues) {
    const result = await run('patch', mode, { body: { title: 'New', if_version: value, content_type: false, mode: [], note: 1 } });
    assert.equal(result.status, 200);
    assert.deepEqual(result.calls.map(([name]) => name), ['json', 'get', 'title']);
  }
});
test('opaque publicId values are never coerced in get, patch, archive, versions or restore', async () => {
  for (const mode of ['ON', 'OFF']) for (const operation of ['get', 'patch', 'archive', 'versions', 'restore']) {
    for (const publicId of ['00050', 'slug/with spaces', '-1', '1e3', '']) {
      const result = await run(operation, mode, { publicId });
      assert.equal(result.status, 200);
      assert.equal(result.calls.find(([name]) => name === 'get')[1].publicId, publicId);
    }
  }
});
test('shared parser runs only ON with body compatibility options and list defaults', async () => {
  const parser = load('src/lib/parsePositiveInt.ts', {});
  for (const operation of ['create', 'list', 'patch', 'restore']) for (const mode of ['ON', 'OFF', 'FLAG_FAILURE', 'USER_FAILURE', 'NO_SESSION']) {
    const parsed = [];
    const result = await run(operation, mode, { mocks: {
      '@/lib/parsePositiveInt': { parsePositiveInt: (...args) => { parsed.push(args); return parser.parsePositiveInt(...args); } },
    } });
    assert.deepEqual(contract(result), contract(await run(operation, 'OFF')));
    const values = { create: [50, 61], list: ['50'], patch: [3], restore: [91] }[operation];
    assert.deepEqual(parsed, mode === 'ON' ? values.map((value) => operation === 'list' ? [value] : [value, { safe: false, max: Infinity }]) : []);
  }
});
