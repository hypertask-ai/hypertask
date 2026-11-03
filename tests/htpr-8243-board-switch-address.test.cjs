const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

const analyticsStubs = {
  '@/lib/analytics/appPerformanceScope': {
    AUTHENTICATED_APP_HOSTNAME: 'app.hypertask.ai',
    performanceDeviceClass: () => 'desktop',
  },
  '@/lib/analytics/productPerformance': {
    emitProductPerformanceEvent: () => {},
  },
};

const loadBoardSwitchLatency = () =>
  loadModule('src/lib/analytics/boardSwitchLatency.ts', analyticsStubs);

const withIntent = (run, intent) => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    __htBoardSwitchIntent: intent
      ? { ...intent, markedAt: performance.now() + intent.ageMs }
      : undefined,
  };
  try {
    return run();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
};

test('HTPR-8243 no pending board switch leaves the address tidy-up alone', () => {
  const { boardSwitchIntentHoldsAddressRepair } = loadBoardSwitchLatency();
  assert.equal(withIntent(() => boardSwitchIntentHoldsAddressRepair(8243), null), false);
});

test('HTPR-8243 the board the address already names is not held', () => {
  const { boardSwitchIntentHoldsAddressRepair } = loadBoardSwitchLatency();
  const intent = { surface: 'sidebar', projectId: 8243, ageMs: 0 };
  assert.equal(withIntent(() => boardSwitchIntentHoldsAddressRepair(8243), intent), false);
});

test('HTPR-8243 a fresh switch to another board holds the address tidy-up', () => {
  const { boardSwitchIntentHoldsAddressRepair } = loadBoardSwitchLatency();
  const intent = { surface: 'sidebar', projectId: 9001, ageMs: -500 };
  assert.equal(withIntent(() => boardSwitchIntentHoldsAddressRepair(8243), intent), true);
});

test('HTPR-8243 the hold ends with the intent window instead of lasting forever', () => {
  const { boardSwitchIntentHoldsAddressRepair } = loadBoardSwitchLatency();
  const insideWindow = { surface: 'keyboard_shortcut', projectId: 9001, ageMs: -29_000 };
  const outsideWindow = { surface: 'keyboard_shortcut', projectId: 9001, ageMs: -31_000 };
  assert.equal(withIntent(() => boardSwitchIntentHoldsAddressRepair(8243), insideWindow), true);
  assert.equal(withIntent(() => boardSwitchIntentHoldsAddressRepair(8243), outsideWindow), false);
});

test('HTPR-8243 a hold marked in the future never applies', () => {
  const { boardSwitchIntentHoldsAddressRepair } = loadBoardSwitchLatency();
  const intent = { surface: 'mobile', projectId: 9001, ageMs: 60_000 };
  assert.equal(withIntent(() => boardSwitchIntentHoldsAddressRepair(8243), intent), false);
});
