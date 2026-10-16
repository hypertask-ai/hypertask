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
  assert.match(layout, /const memoryOnly = await isFeatureEnabled\(HTPR_7278_MEMORY_ONLY_TRACKING_FLAG, userId\);\s*return memoryOnly \? "memory" : "localStorage\+cookie";/);
  assert.match(layout, /\(await featureFlagCandidateUserIds\(HTPR_7278_MEMORY_ONLY_TRACKING_FLAG\)\) === null;\s*return releasedToEveryone \? "memory" : "localStorage\+cookie";/);
  assert.match(layout, /browserTrackingPersistence\(analyticsSession\?\.id \?\? null\)/);
  assert.match(layout, /trackingPersistence=\{trackingPersistence\}/);
});

test("an unreadable flag keeps the previous browser storage", () => {
  assert.match(layout, /\.catch\(\(error\) => \{[\s\S]*?return "localStorage\+cookie" as const;/);
});

test("PostHog stores exactly where the server said", () => {
  assert.match(analytics, /persistence: persistenceRef\.current,/);
  assert.doesNotMatch(analytics, /persistence: "localStorage\+cookie"/);
});

test("memory-only never records sessions, even for demo guests", () => {
  const recordsSessions = new Function(
    "identity",
    "persistence",
    `return ${analytics.match(/const recordsSessions = \(identity: AnalyticsIdentity, persistence: TrackingPersistence\) =>\s*([^;]+);/)[1]};`,
  );
  assert.equal(recordsSessions({ isGuest: true }, "memory"), false);
  assert.equal(recordsSessions({ isGuest: true }, "localStorage+cookie"), true);
  assert.equal(recordsSessions({ isGuest: false }, "localStorage+cookie"), false);
  assert.equal((analytics.match(/startSessionRecording\(\)/g) ?? []).length, 2);
  assert.equal((analytics.match(/if \(recordsSessions\(identity, [^)]+\)\) posthog\.startSessionRecording\(\)/g) ?? []).length, 2);
});

test("error capture stays on", () => {
  assert.match(analytics, /capture_exceptions: true/);
});
