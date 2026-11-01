const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  PROJECT_WEB_VITAL_EVENT,
  isAuthenticatedProjectUrl,
  scopeProjectWebVitalsEvent,
} = jiti(path.join(root, "src/lib/analytics/appPerformanceScope.ts"));
const {
  buildAuthenticatedProjectWebVital,
  shouldInstallAuthenticatedProjectWebVitals,
} = jiti(
  path.join(root, "src/lib/analytics/appWebVitals.ts"),
);
const { metricBelongsToIdentityWindow } = jiti(
  path.join(root, "src/lib/analytics/appWebVitals.ts"),
);

test("only the exact authenticated project URL belongs to the app speed series", () => {
  assert.equal(
    isAuthenticatedProjectUrl(
      new URL("https://app.hypertask.ai/project?id=15&view=speed"),
    ),
    true,
  );
  assert.equal(
    isAuthenticatedProjectUrl(new URL("https://hypertask.ai/project?id=15")),
    false,
  );
  assert.equal(
    isAuthenticatedProjectUrl(new URL("https://app.hypertask.ai/login")),
    false,
  );
  assert.equal(
    isAuthenticatedProjectUrl(
      new URL("https://preview.example.vercel.app/project?id=15"),
    ),
    false,
  );
});

test("project web vitals get a dedicated app-only event", () => {
  const result = scopeProjectWebVitalsEvent(
    {
      event: "$web_vitals",
      properties: {
        $current_url: "https://app.hypertask.ai/project?id=15",
        $web_vitals_LCP_value: 1800,
      },
    },
    { userId: 6, isGuest: false },
  );

  assert.equal(result.event, PROJECT_WEB_VITAL_EVENT);
  assert.equal(result.properties.analytics_surface, "authenticated_app");
  assert.equal(result.properties.app_hostname, "app.hypertask.ai");
  assert.equal(result.properties.route_path, "/project");
});

test("early project vitals retain the existing report property contract", () => {
  const capture = buildAuthenticatedProjectWebVital({
    metric: {
      id: "v4-123",
      name: "LCP",
      value: 1800,
      delta: 1800,
      rating: "good",
      navigationType: "navigate",
    },
    observedUrl: "https://app.hypertask.ai/project?id=15&view=speed",
    identity: { userId: 6, isGuest: false },
    deviceClass: "mobile",
  });

  assert.equal(capture.event, PROJECT_WEB_VITAL_EVENT);
  assert.equal(capture.properties.$web_vitals_LCP_value, 1800);
  assert.equal(capture.properties.device_class, "mobile");
  assert.equal(capture.properties.app_speed_scope_version, 2);
  assert.equal(
    capture.properties.$current_url,
    "https://app.hypertask.ai/project",
  );
  assert.equal(capture.properties.$pathname, "/project");
});

test("early vitals reject marketing, guest, and unsupported metrics", () => {
  const base = {
    metric: { id: "v4-123", name: "LCP", value: 1800 },
    observedUrl: "https://app.hypertask.ai/project?id=15",
    identity: { userId: 6, isGuest: false },
    deviceClass: "desktop",
  };

  assert.equal(
    buildAuthenticatedProjectWebVital({
      ...base,
      observedUrl: "https://hypertask.ai/",
    }),
    null,
  );
  assert.equal(
    buildAuthenticatedProjectWebVital({
      ...base,
      identity: { userId: 6, isGuest: true },
    }),
    null,
  );
  assert.equal(
    buildAuthenticatedProjectWebVital({
      ...base,
      metric: { id: "custom", name: "CPU", value: 99 },
    }),
    null,
  );
});

test("document-scoped callbacks remain bound to their document entry route", () => {
  const capture = buildAuthenticatedProjectWebVital({
    metric: { id: "v4-123", name: "INP", value: 120 },
    observedUrl: "https://app.hypertask.ai/project?id=15&view=speed",
    identity: { userId: 6, isGuest: false },
    deviceClass: "mobile",
  });

  assert.equal(capture.properties.route_path, "/project");
  assert.equal(
    capture.properties.$current_url,
    "https://app.hypertask.ai/project",
  );
});

test("project observers install only for an eligible unchanged document entry", () => {
  const input = {
    documentEntryUrl: "https://app.hypertask.ai/project?id=15",
    identity: { userId: 6, isGuest: false },
    documentRouteTransitioned: false,
  };

  assert.equal(shouldInstallAuthenticatedProjectWebVitals(input), true);
  assert.equal(
    shouldInstallAuthenticatedProjectWebVitals({
      ...input,
      documentEntryUrl: "https://app.hypertask.ai/inbox",
    }),
    false,
  );
  assert.equal(
    shouldInstallAuthenticatedProjectWebVitals({
      ...input,
      identity: { userId: 6, isGuest: true },
    }),
    false,
  );
  assert.equal(
    shouldInstallAuthenticatedProjectWebVitals({
      ...input,
      documentRouteTransitioned: true,
    }),
    false,
  );
});

test("same-document login permanently rejects navigation metrics but accepts fresh interactions", () => {
  const lcp = { id: "lcp", name: "LCP", value: 1800, entries: [{ startTime: 50 }] };
  const priorInp = { id: "inp-1", name: "INP", value: 180, entries: [{ startTime: 90 }] };
  const freshInp = { id: "inp-2", name: "INP", value: 120, entries: [{ startTime: 130 }] };

  assert.equal(metricBelongsToIdentityWindow(lcp, false, 0, 60), true);
  assert.equal(metricBelongsToIdentityWindow(lcp, true, 100, 140), false);
  assert.equal(metricBelongsToIdentityWindow(lcp, true, 100, 10_000), false);
  assert.equal(metricBelongsToIdentityWindow(priorInp, true, 100, 140), false);
  assert.equal(metricBelongsToIdentityWindow(freshInp, true, 100, 140), true);
});

test("marketing and non-project vitals retain the shared PostHog event", () => {
  for (const currentUrl of [
    "https://hypertask.ai/",
    "https://www.hypertask.ai/pricing",
    "https://app.hypertask.ai/login",
  ]) {
    const event = {
      event: "$web_vitals",
      properties: { $current_url: currentUrl },
    };
    assert.equal(
      scopeProjectWebVitalsEvent(event, { userId: 6, isGuest: false }),
      event,
    );
  }
});

test("logged-out and guest project visits cannot enter the app series", () => {
  for (const identity of [
    { userId: null, isGuest: false },
    { userId: 123, isGuest: true },
  ]) {
    const event = {
      event: "$web_vitals",
      properties: {
        $current_url: "https://app.hypertask.ai/project?id=15",
      },
    };
    assert.equal(scopeProjectWebVitalsEvent(event, identity), event);
  }
});

test("non-vital product events are untouched", () => {
  const event = {
    event: "app_task_create_latency",
    properties: { $current_url: "https://app.hypertask.ai/project?id=15" },
  };
  assert.equal(
    scopeProjectWebVitalsEvent(event, { userId: 6, isGuest: false }),
    event,
  );
});
