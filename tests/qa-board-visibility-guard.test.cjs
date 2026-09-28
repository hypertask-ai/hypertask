const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const jiti = require('jiti')(__filename, {
  interopDefault: true,
  cache: false,
});

const { assertColumnsStayVisible } = jiti(
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
        first: () => ({
          waitFor: async () => {},
          isVisible: async () => true,
        }),
      };
    },
    getByRole: () => ({
      first: () => ({ isVisible: async () => false }),
    }),
  };

  await assertColumnsStayVisible(page, '.kanban-column-title', 0);
});

function hydratedPage({
  columnCounts,
  firstColumnVisible = true,
  hiddenEmptyStateVisible = false,
}) {
  let columnRead = 0;
  return {
    locator(selector) {
      if (selector === '[data-board-tasks-hydrated="true"]') {
        return { count: async () => 1 };
      }
      return {
        count: async () => {
          const count = columnCounts[Math.min(columnRead, columnCounts.length - 1)];
          columnRead++;
          return count;
        },
        first: () => ({
          waitFor: async () => {},
          isVisible: async () => firstColumnVisible,
        }),
      };
    },
    getByRole: () => ({
      first: () => ({ isVisible: async () => hiddenEmptyStateVisible }),
    }),
    waitForTimeout: async () => {},
  };
}

test('accepts the intentional hidden-empty-columns state after hydration', async () => {
  const page = hydratedPage({
    columnCounts: [0],
    hiddenEmptyStateVisible: true,
  });

  await assertColumnsStayVisible(page, '.kanban-column-title', 0);
});

test('rejects a board that renders neither columns nor its empty state', async () => {
  const page = hydratedPage({ columnCounts: [0] });

  await assert.rejects(
    assertColumnsStayVisible(page, '.kanban-column-title', 0),
    /no ".kanban-column-title" columns present to watch/,
  );
});

test('rejects attached but hidden board columns even with an empty state', async () => {
  const page = hydratedPage({
    columnCounts: [3],
    firstColumnVisible: false,
    hiddenEmptyStateVisible: true,
  });

  await assert.rejects(
    assertColumnsStayVisible(page, '.kanban-column-title', 0),
    /board columns became hidden/,
  );
});

test('rejects partial column loss after hydration', async () => {
  const page = hydratedPage({ columnCounts: [3, 3, 1] });

  await assert.rejects(
    assertColumnsStayVisible(page, '.kanban-column-title', 100),
    /board lost columns \(had 3, now 1\)/,
  );
});
