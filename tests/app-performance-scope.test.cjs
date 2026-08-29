const assert = require("node:assert/strict");
const fs = require("node:fs");
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

test("analytics identity comes from the signed server session, never document.cookie", () => {
  const layoutSource = fs.readFileSync(
    path.join(root, "src/app/layout.tsx"),
    "utf8",
  );
  const analyticsSource = fs.readFileSync(
    path.join(root, "src/components/Analytics/PostHogAnalytics.tsx"),
    "utf8",
  );

  assert.match(layoutSource, /verifySession\(/);
  assert.match(layoutSource, /cookieStore\.get\(SESSION_COOKIE\)/);
  assert.match(layoutSource, /authenticatedUserId=\{analyticsSession\?\.id/);
  assert.doesNotMatch(analyticsSource, /document\.cookie/);
});

test("app analytics use the slim PostHog runtime", () => {
  const analyticsSource = fs.readFileSync(
    path.join(root, "src/components/Analytics/PostHogAnalytics.tsx"),
    "utf8",
  );

  assert.match(analyticsSource, /posthog-js\/dist\/module\.slim/);
  assert.doesNotMatch(analyticsSource, /import\("posthog-js"\)/);
  assert.match(analyticsSource, /autocapture: true/);
  assert.doesNotMatch(analyticsSource, /next\/web-vitals|useReportWebVitals/);
  assert.match(
    analyticsSource,
    /installAuthenticatedProjectWebVitals = useCallback[\s\S]*shouldInstallAuthenticatedProjectWebVitals[\s\S]*await import\([\s\S]*"web-vitals"/,
  );
  assert.match(
    analyticsSource,
    /getCookieConsent\(\) === "essential"[\s\S]*await import\([\s\S]*posthog-js\/dist\/module\.slim/,
  );
  assert.match(
    analyticsSource,
    /installProductPerformanceSink\([\s\S]*analyticsInitializationReadyRef\.current = true;[\s\S]*await installAuthenticatedProjectWebVitals\(\)/,
  );
  assert.match(analyticsSource, /pendingWebVitalsRef/);
  assert.match(analyticsSource, /capture_performance: false/);
  assert.match(analyticsSource, /posthog\.startSessionRecording\(\)/);
});

test("deferred web-vitals keeps the dependency's buffered-entry guarantee", () => {
  const packageRoot = path.resolve(
    path.dirname(require.resolve("web-vitals")),
    "..",
  );
  const readme = fs.readFileSync(path.join(packageRoot, "README.md"), "utf8");
  const observerSource = fs.readFileSync(
    path.join(packageRoot, "dist/modules/lib/observe.js"),
    "utf8",
  );

  assert.match(
    readme,
    /access performance entries that occurred before the library was loaded/,
  );
  assert.match(
    readme,
    /library should be deferred until after other user-impacting code has loaded/,
  );
  assert.match(observerSource, /type,\s*buffered: true/);
});

test("authenticated analytics wait until product readiness has painted", () => {
  const analyticsSource = fs.readFileSync(
    path.join(root, "src/components/Analytics/PostHogAnalytics.tsx"),
    "utf8",
  );
  const performanceSource = fs.readFileSync(
    path.join(root, "src/lib/analytics/productPerformance.ts"),
    "utf8",
  );

  assert.match(analyticsSource, /authenticatedUserId !== null/);
  assert.match(analyticsSource, /PRODUCT_PERFORMANCE_READY_EVENT/);
  assert.match(analyticsSource, /AUTHENTICATED_ANALYTICS_PAINT_SETTLE_MS/);
  assert.match(analyticsSource, /AUTHENTICATED_ANALYTICS_MAX_WAIT_MS/);
  assert.match(analyticsSource, /ANONYMOUS_ANALYTICS_FALLBACK_MS = 1_000/);
  assert.match(
    analyticsSource,
    /__hypertaskProductPerformanceQueue\?\.some\([\s\S]*isProductReadinessEvent/,
  );
  assert.match(
    performanceSource,
    /queue\.push\(\{ \.\.\.event, __hypertaskAccountId: accountId \}\)[\s\S]*dispatchEvent\(new Event\(PRODUCT_PERFORMANCE_READY_EVENT\)\)/,
  );
  assert.match(
    analyticsSource,
    /scheduleInIdlePeriod\(ANONYMOUS_ANALYTICS_FALLBACK_MS\)/,
  );
  assert.match(
    analyticsSource,
    /scheduleControllerRef\.current\?\.setAuthenticated\([\s\S]*authenticatedUserId !== null/,
  );
  assert.match(
    analyticsSource,
    /scheduleAfterProductReady\(\) \{[\s\S]*clearTimeout\(fallbackTimer\)[\s\S]*paintSettleTimer = setTimeout/,
  );
  assert.match(
    analyticsSource,
    /const initialPageview = initialPageviewRef\.current \?\? \{/,
  );
  assert.match(
    analyticsSource,
    /window\.location\.href !== initialPageview\.href[\s\S]*loadedPostHog\.capture\("\$pageview", \{[\s\S]*\$current_url: initialPageview\.href[\s\S]*\$pathname: initialPageview\.pathname/,
  );
  assert.match(
    analyticsSource,
    /useLayoutEffect\(\(\) => \{[\s\S]*latestIdentityRef\.current = committedIdentity;[\s\S]*identityKey\(appliedIdentityRef\.current\) !== committedIdentityKey[\s\S]*identityReadyRef\.current = false/,
  );
  assert.match(
    analyticsSource,
    /latestIdentityKey !== identityKey\(appliedIdentityRef\.current\)[\s\S]*return;/,
  );
  assert.match(
    analyticsSource,
    /useLayoutEffect\(\(\) => \{[\s\S]*currentPathname !== initialPageviewRef\.current\.pathname[\s\S]*documentRouteTransitionedRef\.current = true/,
  );
  assert.match(
    analyticsSource,
    /if \(!documentEntry \|\| documentRouteTransitionedRef\.current\) return;[\s\S]*observedUrl: documentEntry\.href/,
  );
  assert.match(
    analyticsSource,
    /queued\.identityKey !== identityKey\(latestIdentity\)[\s\S]*queued\.identityKey !== identityKey\(appliedIdentityRef\.current\)[\s\S]*metricBelongsToIdentityWindow/,
  );
  assert.match(
    analyticsSource,
    /latestIdentity\.isGuest \|\|[\s\S]*latestIdentity\.userId !== accountId[\s\S]*identityKey\(latestIdentity\) !==[\s\S]*identityKey\(appliedIdentityRef\.current\)/,
  );
  assert.match(
    analyticsSource,
    /useLayoutEffect\(\(\) => \{[\s\S]*performanceIdentityKeyRef\.current = committedIdentityKey;[\s\S]*pendingWebVitalsRef\.current = \[\]/,
  );
  assert.doesNotMatch(
    analyticsSource,
    /latestIdentityRef\.current = \{\s*userId: authenticatedUserId/,
  );
  assert.match(
    analyticsSource,
    /webVitalsInstallStateRef\.current = "installing";[\s\S]*await import\([\s\S]*"web-vitals"[\s\S]*webVitalsInstallStateRef\.current = "installed";/,
  );
  assert.match(
    analyticsSource,
    /appliedIdentityRef\.current = identity;[\s\S]*installAuthenticatedProjectWebVitals\(\)/,
  );
  assert.match(
    analyticsSource,
    /webVitalsInstallStateRef\.current !== "idle"[\s\S]*return;[\s\S]*webVitalsInstallAttemptRef/,
  );
});

test("field reports keep legacy and corrected Web Vitals separate", () => {
  const reportSource = fs.readFileSync(
    path.join(root, "scripts/report-app-project-vitals.mjs"),
    "utf8",
  );

  assert.match(reportSource, /properties\.app_speed_scope_version/);
  assert.match(reportSource, /GROUP BY device_class, scope_version/);
  assert.match(reportSource, /early-observer/);
  assert.match(reportSource, /v1-late-observer/);
  assert.match(reportSource, /unversioned/);
});

test("readiness reports bound corrected route-entry samples to 0-10 seconds", () => {
  const reportSource = fs.readFileSync(
    path.join(root, "scripts/report-app-project-vitals.mjs"),
    "utf8",
  );

  assert.match(
    reportSource,
    /readinessDurationValidSql = `\$\{readinessDurationSql\} >= 0 AND \$\{readinessDurationSql\} <= 10000`/,
  );
  assert.match(
    reportSource,
    /readinessSampleValidSql = `coalesce\(\(\$\{readinessDurationValidSql\}\) AND if\(/,
  );
  assert.match(
    reportSource,
    /event = 'app_board_readiness',[\s\S]*readiness_measurement_version\)\) >= 2[\s\S]*readiness_measurement_scope\) = 'project_route_entry'/,
  );
  assert.match(reportSource, /invalid scope and samples outside 0-10s excluded/);
});

test("mobile reports use physical device type instead of narrow desktop viewports", () => {
  const reportSource = fs.readFileSync(
    path.join(root, "scripts/report-app-project-vitals.mjs"),
    "utf8",
  );

  assert.match(reportSource, /properties\.\$device_type\) = 'Mobile'/);
  assert.match(
    reportSource,
    /properties\.\$device_type IN \('Mobile', 'Desktop'\)/,
  );
  assert.doesNotMatch(
    reportSource,
    /toString\(properties\.device_class\) AS device_class/,
  );
});

test("persisted and live auth changes cannot leak a prior PostHog identity", () => {
  const analyticsSource = fs.readFileSync(
    path.join(root, "src/components/Analytics/PostHogAnalytics.tsx"),
    "utf8",
  );
  const authSource = fs.readFileSync(
    path.join(root, "src/hooks/General/useAuth.tsx"),
    "utf8",
  );
  const accountsSource = fs.readFileSync(
    path.join(root, "src/lib/auth/accounts.ts"),
    "utf8",
  );
  const signoutSource = fs.readFileSync(
    path.join(root, "src/hooks/MultiPages/HTC/useSignout.ts"),
    "utf8",
  );

  assert.match(
    analyticsSource,
    /const committedIdentity = \{[\s\S]*userId: authenticatedUserId[\s\S]*latestIdentityRef\.current = committedIdentity/,
  );
  assert.match(analyticsSource, /posthog\.stopSessionRecording\(\)/);
  assert.match(analyticsSource, /posthog\.get_property\("\$user_id"\)/);
  assert.match(analyticsSource, /posthog\.get_property\("\$user_state"\)/);
  assert.match(
    analyticsSource,
    /persistedAccountId !== expectedAccountId[\s\S]*posthog\.reset\(\)/,
  );
  assert.match(
    analyticsSource,
    /loaded: \(loadedPostHog\) => {[\s\S]*reconcilePersistedIdentity\(/,
  );
  assert.match(
    analyticsSource,
    /before_send: \(event\) => {[\s\S]*if \(!identityReadyRef\.current\) return null/,
  );
  assert.match(
    analyticsSource,
    /reconcilePersistedIdentity\(loadedPostHog, loadedIdentity, \(\) => {[\s\S]*identityReadyRef\.current = true/,
  );
  assert.match(
    analyticsSource,
    /markIdentitySafe\(\);[\s\S]*posthog\.identify\(expectedAccountId\)/,
  );
  assert.match(
    analyticsSource,
    /if \(previousIdentity\.userId !== null\) posthog\.reset\(\)/,
  );
  assert.match(analyticsSource, /posthog\.set_config\(/);
  assert.match(authSource, /await router\.refresh\(\)/);
  assert.match(accountsSource, /window\.location\.assign\("\/inbox"\)/);
  assert.match(signoutSource, /window\.location\.href = "\/login"/);
});
