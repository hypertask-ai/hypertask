const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const analytics = source("src/components/Analytics/PostHogAnalytics.tsx");
const layout = source("src/app/layout.tsx");
const definition = source("src/lib/flags/definitions/htpr-7278-memory-only-tracking.ts");

test("the flag is an honest improvement flag on the repo default", () => {
  assert.match(definition, /key: HTPR_7278_MEMORY_ONLY_TRACKING_FLAG/);
  assert.match(definition, /kind: "improvement"/);
  assert.doesNotMatch(definition, /defaultMode/);
});

test("the layout reads the flag on the server for signed-in and signed-out visitors", () => {
  assert.match(layout, /isFeatureEnabled\(HTPR_7278_MEMORY_ONLY_TRACKING_FLAG, analyticsSession\.id\)/);
  assert.match(layout, /featureFlagCandidateUserIds\(HTPR_7278_MEMORY_ONLY_TRACKING_FLAG\)\.then\(\(ids\) => ids === null\)/);
  assert.match(layout, /memoryOnlyTracking=\{memoryOnlyTracking\}/);
});

test("an unreadable flag keeps the previous browser storage", () => {
  assert.match(layout, /\.catch\(\(error\) => \{[\s\S]*?return false;/);
});

test("flag on keeps PostHog in memory, flag off keeps cookie and localStorage", () => {
  assert.match(analytics, /persistence: memoryOnlyRef\.current \? "memory" : "localStorage\+cookie"/);
});

test("flag on never records sessions, even for demo guests", () => {
  const recordsSessions = new Function(
    "identity",
    "memoryOnly",
    `return ${analytics.match(/const recordsSessions = \(identity: AnalyticsIdentity, memoryOnly: boolean\) =>\s*([^;]+);/)[1]};`,
  );
  assert.equal(recordsSessions({ isGuest: true }, true), false);
  assert.equal(recordsSessions({ isGuest: true }, false), true);
  assert.equal(recordsSessions({ isGuest: false }, false), false);
  assert.doesNotMatch(analytics, /if \(identity\.isGuest\) posthog\.startSessionRecording\(\)/);
  assert.equal((analytics.match(/startSessionRecording\(\)/g) ?? []).length, 2);
  assert.equal((analytics.match(/if \(recordsSessions\(identity, [^)]+\)\) posthog\.startSessionRecording\(\)/g) ?? []).length, 2);
});

test("error capture stays on", () => {
  assert.match(analytics, /capture_exceptions: true/);
});
