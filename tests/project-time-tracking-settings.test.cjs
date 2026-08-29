const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename);
const {
  projectTimeTrackingResponse,
  projectTimeTrackingUpdate,
  projectTimeTrackingUpdateGuard,
} = jiti(
  path.join(root, "src/lib/projectTimeTrackingSettings.ts"),
);

test("updates total visibility without changing time tracking", () => {
  assert.deepEqual(projectTimeTrackingUpdate({ showTimeTotals: true }), {
    showTimeTotals: true,
  });
});

test("turning time tracking off also hides totals", () => {
  assert.deepEqual(projectTimeTrackingUpdate({ enabled: false }), {
    showTimeTotals: false,
    timeTrackingEnabled: false,
  });
});

test("turning time tracking off wins over a conflicting totals value", () => {
  assert.deepEqual(
    projectTimeTrackingUpdate({ enabled: false, showTimeTotals: true }),
    {
      showTimeTotals: false,
      timeTrackingEnabled: false,
    },
  );
});

test("rejects a request with no recognized setting", () => {
  assert.equal(projectTimeTrackingUpdate({ enabled: "true" }), null);
  assert.equal(projectTimeTrackingUpdate(null), null);
});

test("enabling totals requires time tracking in the same database update", () => {
  assert.deepEqual(
    projectTimeTrackingUpdateGuard({ showTimeTotals: true }),
    { timeTrackingEnabled: true },
  );
  assert.deepEqual(
    projectTimeTrackingUpdateGuard({ showTimeTotals: false }),
    {},
  );
});

test("keeps the existing enabled response field for current callers", () => {
  assert.deepEqual(
    projectTimeTrackingResponse({ timeTrackingEnabled: true }),
    {
      enabled: true,
      success: true,
      timeTrackingEnabled: true,
    },
  );
});
