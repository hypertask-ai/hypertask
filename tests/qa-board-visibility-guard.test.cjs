const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const jiti = require('jiti')(__filename, {
  interopDefault: true,
  cache: false,
});

const { isVisibleBoardState } = jiti(
  path.join(process.cwd(), 'e2e/smoke/lib/loopGuard.ts'),
);

test('accepts empty-board UI after hydrated columns are filtered out', () => {
  const observations = [
    { columnCount: 3, firstColumnVisible: true, hiddenEmptyStateVisible: false },
    { columnCount: 0, firstColumnVisible: false, hiddenEmptyStateVisible: true },
  ];

  assert.equal(observations.every(isVisibleBoardState), true);
});

test('rejects a board that renders neither columns nor its empty state', () => {
  assert.equal(
    isVisibleBoardState({
      columnCount: 0,
      firstColumnVisible: false,
      hiddenEmptyStateVisible: false,
    }),
    false,
  );
});

test('rejects attached but hidden board columns', () => {
  assert.equal(
    isVisibleBoardState({
      columnCount: 3,
      firstColumnVisible: false,
      hiddenEmptyStateVisible: false,
    }),
    false,
  );
});
