const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const analytics = source("src/components/Analytics/PostHogAnalytics.tsx");
const layout = source("src/app/layout.tsx");

test("the layout always uses memory-only PostHog persistence", () => {
  assert.doesNotMatch(layout, /HTPR_7278_MEMORY_ONLY_TRACKING_FLAG/);
  assert.doesNotMatch(layout, /memoryOnlyTracking/);
  assert.match(layout, /trackingPersistence="memory"/);
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
