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

test('waits for columns that render after task hydration', async () => {
  const page = hydratedPage({ columnCounts: [0, 0, 3] });

  await assertColumnsStayVisible(page, '.kanban-column-title', 0);
});

test('rejects a board that renders neither columns nor its empty state', async () => {
  const page = hydratedPage({ columnCounts: [0] });

  await assert.rejects(
    assertColumnsStayVisible(page, '.kanban-column-title', 0, 1),
    /board did not render ".kanban-column-title" columns or its intentional empty state/,
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

test('rejects columns that attach while the empty state remains visible', async () => {
  const page = hydratedPage({
    columnCounts: [0, 3],
    firstColumnVisible: false,
    hiddenEmptyStateVisible: true,
  });

  await assert.rejects(
    assertColumnsStayVisible(page, '.kanban-column-title', 100),
    /hidden empty board unexpectedly rendered columns/,
  );
});

test('rejects partial column loss after hydration', async () => {
  const page = hydratedPage({ columnCounts: [3, 3, 1] });

  await assert.rejects(
    assertColumnsStayVisible(page, '.kanban-column-title', 100),
    /board lost columns \(had 3, now 1\)/,
  );
});

test('counts columns only after the named board is on screen', async () => {
  const started = Date.now();
  const arrived = () => Date.now() - started > 50;
  const columnReads = [];
  const page = {
    locator(selector) {
      if (selector === '[data-board-id="20"][data-board-tasks-hydrated="true"]') {
        return { count: async () => (arrived() ? 1 : 0) };
      }
      if (selector === '[data-board-tasks-hydrated="true"]') {
        return { count: async () => 1 };
      }
      return {
        count: async () => {
          const count = arrived() ? 2 : 3;
          columnReads.push(count);
          return count;
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
    waitForTimeout: async () => {},
  };

  await assertColumnsStayVisible(page, '.kanban-column-title', 200, 1_000, 20);
  assert.equal(columnReads.length > 0, true);
  assert.deepEqual(columnReads, columnReads.map(() => 2));
});

test('rejects a named board that leaves the screen', async () => {
  let columnReads = 0;
  const page = {
    locator(selector) {
      if (selector === '[data-board-id="20"][data-board-tasks-hydrated="true"]') {
        return { count: async () => (columnReads >= 1 ? 0 : 1) };
      }
      return {
        count: async () => {
          columnReads += 1;
          return 2;
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
    waitForTimeout: async () => {},
  };

  await assert.rejects(
    assertColumnsStayVisible(page, '.kanban-column-title', 100, 1_000, 20),
    /board 20 left the screen/,
  );
});
