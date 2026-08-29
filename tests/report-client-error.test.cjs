const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/lib/telemetry/reportClientError.ts"),
  "utf8"
);

function loadReportClientError(context) {
  const javascript = source
    .replace(/export type ClientErrorPayload = \{[\s\S]*?\n\}\n/, "")
    .replace(
      "export function reportClientError(payload: ClientErrorPayload)",
      "function reportClientError(payload)"
    );
  assert.notEqual(javascript, source, "TypeScript source projection failed");
  vm.runInNewContext(
    `${javascript}\nthis.reportClientError = reportClientError`,
    context
  );
  return context.reportClientError;
}

test("client error reporting ignores only expected navigation AbortErrors", () => {
  const beacons = [];
  const reportClientError = loadReportClientError({
    Blob,
    navigator: {
      webdriver: false,
      userAgent: "Mozilla/5.0 Chrome/149.0",
      sendBeacon(url, body) {
        beacons.push({ url, body });
        return true;
      },
    },
    window: { location: { href: "https://app.hypertask.ai/detail/project-339/1487" } },
  });

  reportClientError({
    source: "unhandledrejection",
    message: "signal is aborted without reason",
    stack: "AbortError: signal is aborted without reason\n    at cleanup",
  });
  assert.equal(beacons.length, 0, "navigation AbortErrors are expected cancellation");

  reportClientError({
    source: "window.onerror",
    message: "signal is aborted without reason",
    stack: "Error: signal is aborted without reason",
  });
  assert.equal(beacons.length, 1, "other errors with similar prose still report");
});

test("client error reporting ignores only React Fizz discarded-segment races", () => {
  const beacons = [];
  const reportClientError = loadReportClientError({
    Blob,
    navigator: {
      webdriver: false,
      userAgent: "Mozilla/5.0 Chrome/151.0",
      sendBeacon(url, body) {
        beacons.push({ url, body });
        return true;
      },
    },
    window: { location: { href: "https://app.hypertask.ai/detail/project-339/1566" } },
  });

  reportClientError({
    source: "window.onerror",
    message: "Cannot read properties of null (reading 'parentNode')",
    stack:
      "TypeError: Cannot read properties of null (reading 'parentNode')\n" +
      "    at $RS (https://app.hypertask.ai/detail/project-339/1566:13:226477)",
  });
  assert.equal(beacons.length, 0, "discarded Fizz segments are expected cleanup");

  reportClientError({
    source: "window.onerror",
    message:
      "Uncaught TypeError: Cannot read properties of null (reading 'parentNode')",
    stack:
      "TypeError: Cannot read properties of null (reading 'parentNode')\n" +
      "    at $RS (https://app.hypertask.ai/detail/project-339/1566:13:226477)",
  });
  assert.equal(
    beacons.length,
    0,
    "Chrome's Uncaught TypeError prefix is the same discarded Fizz race",
  );

  reportClientError({
    source: "window.onerror",
    message: 'can\'t access property "parentNode", b is null',
    stack:
      "$RS@https://app.hypertask.ai/detail/project-2313/9:13:73076\n" +
      "@https://app.hypertask.ai/detail/project-2313/9:13:73150",
  });
  assert.equal(
    beacons.length,
    0,
    "Firefox's message and stack syntax describe the same discarded Fizz race",
  );

  reportClientError({
    source: "window.onerror",
    message: 'TypeError: can\'t access property "parentNode", b is null',
    stack:
      "$RS@https://app.hypertask.ai/detail/project-2313/9:13:73220\n" +
      "@https://app.hypertask.ai/detail/project-2313/9:13:73294",
  });
  assert.equal(
    beacons.length,
    0,
    "Firefox may prefix the same window error message with TypeError",
  );

  reportClientError({
    source: "window.onerror",
    message: "Cannot read properties of null (reading 'parentNode')",
    stack: "TypeError: Cannot read properties of null (reading 'parentNode')\n    at updateTask (app.js:1:2)",
  });
  assert.equal(beacons.length, 1, "application parentNode failures still report");

  reportClientError({
    source: "window.onerror",
    message: 'can\'t access property "parentNode", b is null',
    stack: "updateTask@https://app.hypertask.ai/app.js:1:2",
  });
  assert.equal(
    beacons.length,
    2,
    "Firefox application failures with the same message still report",
  );

  reportClientError({
    source: "unhandledrejection",
    message: "Cannot read properties of null (reading 'parentNode')",
    stack: "TypeError: Cannot read properties of null (reading 'parentNode')\n    at $RS (https://app.hypertask.ai/:1:2)",
  });
  assert.equal(beacons.length, 3, "non-window failures still report");
});

test("prefixed Firefox application parentNode failures still report", () => {
  const beacons = [];
  const reportClientError = loadReportClientError({
    Blob,
    navigator: {
      webdriver: false,
      userAgent: "Mozilla/5.0 Firefox/152.0",
      sendBeacon(url, body) {
        beacons.push({ url, body });
        return true;
      },
    },
    window: { location: { href: "https://app.hypertask.ai/project?id=15" } },
  });

  reportClientError({
    source: "window.onerror",
    message: 'TypeError: can\'t access property "parentNode", b is null',
    stack: "updateTask@https://app.hypertask.ai/app.js:1:2",
  });
  assert.equal(beacons.length, 1);
});

test("client error reporting ignores only bare Android-shell transport failures", () => {
  const beacons = [];
  const navigator = {
    webdriver: false,
    userAgent: "Mozilla/5.0 Android 16 wv HypertaskApp",
    sendBeacon(url, body) {
      beacons.push({ url, body });
      return true;
    },
  };
  const reportClientError = loadReportClientError({
    Blob,
    navigator,
    window: { location: { href: "https://app.hypertask.ai/detail/project-2312/1" } },
  });

  reportClientError({
    source: "unhandledrejection",
    message: "Failed to fetch",
    stack: "TypeError: Failed to fetch\n    at nativeFetch",
  });
  assert.equal(beacons.length, 0, "Android transport failures are expected noise");

  reportClientError({
    source: "global-error",
    message: "network error",
    stack: "TypeError: network error",
  });
  assert.equal(
    beacons.length,
    0,
    "Android WebView lowercase network errors are expected transport noise",
  );

  navigator.userAgent = "Mozilla/5.0 Chrome/151.0";
  reportClientError({
    source: "unhandledrejection",
    message: "Failed to fetch",
    stack: "TypeError: Failed to fetch\n    at appCode",
  });
  assert.equal(beacons.length, 1, "the same desktop fetch failure remains actionable");

  reportClientError({
    source: "global-error",
    message: "network error",
    stack: "TypeError: network error",
  });
  assert.equal(beacons.length, 2, "the same desktop network error remains actionable");
});

test("client error reporting filters expected browser noise and records the browser", async () => {
  const beacons = [];
  const navigator = {
    webdriver: false,
    userAgent: "Mozilla/5.0 Chrome/126.0",
    sendBeacon(url, body) {
      beacons.push({ url, body });
      return true;
    },
  };
  const reportClientError = loadReportClientError({
    Blob,
    navigator,
    window: { location: { href: "https://app.hypertask.ai/inbox" } },
    fetch() {
      throw new Error("sendBeacon should be used in this test");
    },
  });

  reportClientError({
    source: "unhandledrejection",
    message: "Request failed with status code 401",
  });
  assert.equal(beacons.length, 0, "expired-session 401s are expected auth recovery");

  reportClientError({
    source: "unhandledrejection",
    message: "Request failed with status code 403",
  });
  assert.equal(beacons.length, 1, "other HTTP status failures must still report");

  navigator.webdriver = true;
  reportClientError({ source: "global-error", message: "React error #310" });
  assert.equal(beacons.length, 1, "WebDriver crashes are automated QA noise");

  navigator.webdriver = false;
  navigator.userAgent = "Mozilla/5.0 HeadlessChrome/126.0";
  reportClientError({ source: "global-error", message: "React error #310" });
  assert.equal(beacons.length, 1, "HeadlessChrome crashes are automated QA noise");

  navigator.userAgent = `Browser/${"x".repeat(240)}`;
  reportClientError({ source: "window.onerror", message: "Real browser crash" });
  assert.equal(beacons.length, 2);

  const body = JSON.parse(await beacons[1].body.text());
  assert.equal(beacons[1].url, "/api/errors");
  assert.equal(body.extra.userAgent, navigator.userAgent.slice(0, 200));
  assert.equal(body.extra.userAgent.length, 200);

  navigator.userAgent = "Mozilla/5.0 Chrome/151.0";
  reportClientError({
    source: "hydration-recoverable",
    message: "React hydration mismatch",
    extra: {
      hydrationDom: "x".repeat(5000),
      hydrationMutations: "children:main:added=font",
      origin: "spoofed",
    },
  });
  const diagnosticBody = JSON.parse(await beacons[2].body.text());
  assert.equal(diagnosticBody.extra.hydrationDom.length, 4000);
  assert.equal(
    diagnosticBody.extra.hydrationMutations,
    "children:main:added=font"
  );
  assert.equal(diagnosticBody.extra.origin, "hydration-recoverable");
});
