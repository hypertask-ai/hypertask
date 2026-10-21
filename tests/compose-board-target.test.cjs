const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { createJiti } = require('jiti');
const jiti = createJiti(__filename, { fsCache: false });
const { resolveComposeBoardTarget } = jiti(path.join(__dirname, '../src/components/Modals/commands/HTC/composeBoardTarget.ts'));

const resolve = (url, overrides = {}) => resolveComposeBoardTarget({ url, lastUsedBoardId: 7, ...overrides });

test('inbox focused ticket wins over board split and last used board', () => {
  for (const url of ['/inbox?split=Board&projectId=8', '/inbox?split=All', '/inbox?split=Important']) {
    assert.deepEqual(resolve(url, { focusedTicketBoardId: 9 }), { boardId: 9, showChip: true });
  }
});

test('inbox board split wins when no ticket is focused', () => {
  assert.deepEqual(resolve('/inbox?split=QA%20Sandbox&projectId=8'), { boardId: 8, showChip: true });
  assert.equal(resolve('/inbox?projectId=8', { focusedTicketBoardId: null }).boardId, 8);
});

for (const split of ['All', 'Important']) {
  test(`${split} split falls back to last used board without a focused ticket`, () => {
    for (const name of [split, split.toLowerCase()]) {
      assert.deepEqual(resolve(`/inbox?split=${name}&projectId=8`), { boardId: 7, showChip: true });
    }
  });
}

test('inbox without a split uses the last used board', () => {
  assert.deepEqual(resolve('/inbox'), { boardId: 7, showChip: true });
});

test('board and ticket views use their board and hide the chip, ignoring stale inbox focus', () => {
  for (const url of ['/project?id=8', '/project/8', '/project/project-8', '/detail/project-8/12']) {
    assert.deepEqual(resolve(url, { focusedTicketBoardId: 9 }), { boardId: 8, showChip: false });
    assert.deepEqual(resolve(url, { selectedBoardId: 9 }), { boardId: 9, showChip: true });
    assert.deepEqual(resolve(url, { selectedBoardId: 8 }), { boardId: 8, showChip: true });
  }
});

test('mixed-board views show the target and ignore stale ticket focus', () => {
  for (const url of ['/my-tasks', '/search', '/all-tasks', '/calendar', '/starred', '/drafts']) {
    assert.deepEqual(resolve(url, { focusedTicketBoardId: 9 }), { boardId: 7, showChip: true });
  }
});

test('explicit board choice overrides caller destination and every inferred target', () => {
  assert.equal(resolve('/inbox?projectId=8', { focusedTicketBoardId: 9, destinationBoardId: 10, selectedBoardId: 11 }).boardId, 11);
  assert.equal(resolve('/project?id=8', { destinationBoardId: 10 }).boardId, 10);
});

test('missing and invalid targets remain unset or fall back instead of choosing an invalid board', () => {
  assert.deepEqual(resolve('/inbox', { lastUsedBoardId: undefined }), { boardId: undefined, showChip: true });
  for (const id of [0, -1, 1.5, NaN, Infinity]) {
    assert.equal(resolve('/inbox?projectId=bad', { focusedTicketBoardId: id, selectedBoardId: id }).boardId, 7);
  }
});
