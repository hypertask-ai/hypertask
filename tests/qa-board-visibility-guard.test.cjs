const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const jiti = require('jiti')(__filename, {
  interopDefault: true,
  cache: false,
});

const { assertColumnsStayVisible, isVisibleBoardState } = jiti(
  path.join(process.cwd(), 'e2e/smoke/lib/loopGuard.ts'),
);

test('waits for the board hydration marker before checking columns', async () => {
  let hydrated = false;
  const page = {
    locator(selector) {
      if (selector === '[data-board-tasks-hydrated="true"]') {
        return {
          count: async () => {
            if (!hydrated) {
              hydrated = true;
              return 0;
            }
            return 1;
          },
        };
      }
      return {
        count: async () => {
          assert.equal(hydrated, true);
          return 3;
        },
        first: () => ({ isVisible: async () => true }),
      };
    },
    getByRole: () => ({
      first: () => ({ isVisible: async () => false }),
    }),
  };

  await assertColumnsStayVisible(page, '.kanban-column-title', 0);
});

test('accepts the intentional hidden-empty-columns state after hydration', () => {
  assert.equal(
    isVisibleBoardState({
      columnCount: 0,
      firstColumnVisible: false,
      hiddenEmptyStateVisible: true,
    }),
    true,
  );
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
