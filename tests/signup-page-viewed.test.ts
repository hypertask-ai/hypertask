import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";

const flag = "htpr-7272-payment-login-agent-events";

function harness() {
  const cache = new Map<string, any>();
  const refs: any[] = [];
  let refIndex = 0;
  let effects: (() => any)[] = [];
  const captures: any[] = [];
  const state = { consent: "all", enabled: true, eligible: true, failure: "", session: null as { id: number } | null, candidates: [6, 985] as number[] | null };
  const flagCalls: any[] = [];
  let config: any;
  let initialize: (() => any) | undefined;
  const window = {
    location: { href: "https://app.hypertask.ai/login?email=private@example.test#secret", pathname: "/login", hostname: "app.hypertask.ai" },
    requestIdleCallback: (callback: () => any) => { initialize = callback; return 1; },
    cancelIdleCallback: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const posthog = {
    init: (_key: string, options: any) => { config = options; options.loaded(posthog); },
    get_property: () => null,
    get_distinct_id: () => "anonymous",
    stopSessionRecording: () => {},
    startSessionRecording: () => {},
    reset: () => {},
    set_config: () => {},
    identify: () => {},
    capture: (...args: any[]) => captures.push(args),
  };
  const mocks: Record<string, any> = {
    react: {
      useRef: (initial: any) => refs[refIndex++] ??= { current: initial },
      useEffect: (callback: () => any) => effects.push(callback),
      useLayoutEffect: (callback: () => any) => effects.push(callback),
      useCallback: (callback: any) => callback,
    },
    "react/jsx-runtime": { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }), Fragment: "fragment" },
    "next/navigation": { usePathname: () => "/login" },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "session-token" }) }) },
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => state.session },
    "@/lib/flags": {
      HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG: flag,
      isFeatureEnabled: async (...args: any[]) => { flagCalls.push(args); if (state.failure === "flag") throw Error("flag lookup failed"); return state.enabled; },
      featureFlagCandidateUserIds: async (key: string) => { flagCalls.push([key]); if (state.failure === "flag") throw Error("flag lookup failed"); return state.candidates; },
    },
    "@/lib/flags/keys": { HTPR_7272_PAYMENT_LOGIN_AGENT_EVENTS_FLAG: flag, HTPR_7627_TICKET_FIRST_SCREEN_FLAG: "htpr-7627-ticket-first-screen" },
    "@/lib/telemetry/activationAnalytics": { isActivationEligible: async () => { if (state.failure === "eligibility") throw Error("eligibility lookup failed"); return state.eligible; } },
    "@/lib/cookieConsent": { getCookieConsent: () => state.consent, onCookieConsentChange: () => () => {} },
    "@/lib/analytics/productPerformance": { installProductPerformanceSink: () => () => {} },
    "@/lib/analytics/appPerformanceScope": { scopeProjectWebVitalsEvent: (event: any) => event },
    "@/lib/analytics/appWebVitals": { shouldInstallAuthenticatedProjectWebVitals: () => false },
    "@/lib/analytics/browserNoise": { dropResizeObserverLoopException: (event: any) => event, dropSelfRecoveringChunkLoadException: (event: any) => event, dropNetworkBlipException: (event: any) => event },
    "posthog-js/dist/module.slim": { default: posthog },
    "posthog-js/dist/extension-bundles": { ErrorTrackingExtensions: {} },
    "@/utils/Providers": { default: "Provider" },
    "@/hooks/useFlag": { FeatureFlagProvider: "FeatureFlagProvider", SubscribedFeatureFlagProvider: "SubscribedFeatureFlagProvider" },
    "@/components/Analytics/PostHogAnalytics": { default: "PostHogAnalytics" },
    "@vercel/speed-insights/next": { SpeedInsights: "SpeedInsights" },
    "@/components/ErrorBoundary/ClientErrorReporter": { default: "ClientErrorReporter" },
    "@/components/System/DeploySkewGuard": { default: "DeploySkewGuard" },
    "@/components/FilesImageFallback": { default: "FilesImageFallback" },
    "@/utils/serverActions": { isMobileDevice: async () => ({ isMobile: false, isApple: false }) },
    "@/lib/firstScreen/serverBoardDocument": { getServerBoardDocument: async () => null },
    "@/lib/firstScreen/serverInboxDocument": { getServerInboxDocument: async () => null },
    "@/lib/firstScreen/serverTicketShell": { getServerTicketShell: async () => null },
    "@/lib/configs/auth.config": { default: { cookies: { theme: "theme", defaultTheme: "porcelain" } } },
    "@/lib/configs/general.config": { DIV_ID_CONSTANTS: { bodyLayout: "body-layout" } },
    "@/lib/fonts/inter": { inter: {} },
    "@/lib/fonts/newsreader": { newsreader: {} },
    "@/lib/fonts/ibmPlexSans": { ibmPlexSans: {} },
    "@/lib/themePreferences": { normalizeThemePreference: () => "porcelain", resolveInitialThemeColor: () => "#fff", resolveThemePreference: () => "porcelain", resolvedThemeDomMetadata: { porcelain: { classes: ["light", "porcelain"], themeColor: "#fff" } } },
    "@/lib/themeBootScript": { buildThemeBootScript: () => "" },
    "@/lib/appShellBootstrap/client": { buildEarlyAppShellBootstrapScript: () => "" },
    "@/components/analytics/StoreUTM": { default: "UTMCookieHandler" },
    "@/app/login/LoginComponent": { default: "LoginComponent" },
  };
  function load(file: string): any {
    const absolute = path.resolve(file);
    if (cache.has(absolute)) return cache.get(absolute);
    const loaded = { exports: {} };
    cache.set(absolute, loaded.exports);
    const compiled = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const requireMock = (name: string) => {
      if (name.endsWith(".css") || name.endsWith(".scss")) return {};
      if (name.startsWith(".")) name = "@/" + path.relative(path.resolve("src"), path.resolve(path.dirname(absolute), name)).replace(/\.[jt]sx?$/, "");
      if (name in mocks) return { __esModule: true, ...mocks[name] };
      if (name.startsWith("@/")) {
        const target = "src/" + name.slice(2);
        return load(fs.existsSync(target + ".ts") ? target + ".ts" : target + ".tsx");
      }
      throw Error(`Unmocked dependency: ${name}`);
    };
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
      window, document: { title: "Login" }, performance, crypto: { randomUUID }, console,
      process: { env: { NODE_ENV: "test", NEXT_PUBLIC_POSTHOG_KEY: "mock-local-only" } },
      setTimeout: (callback: () => any) => { initialize = callback; return 1; }, clearTimeout: () => {},
    })(requireMock, loaded, loaded.exports);
    return loaded.exports;
  }
  let previousComponent: any;
  function render(Component: any, props: any, remount = false) {
    if (Component !== previousComponent || remount) refs.length = 0;
    previousComponent = Component;
    refIndex = 0;
    effects = [];
    const result = Component(props);
    return { result, effects: [...effects] };
  }
  return { load, render, state, mocks, captures, flagCalls, posthog, refs, get config() { return config; }, initialize: () => initialize?.() };
}

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function startAnalytics(h: ReturnType<typeof harness>, userId: number | null = null) {
  const Analytics = h.load("src/components/Analytics/PostHogAnalytics.tsx").default;
  const rendered = h.render(Analytics, { authenticatedUserId: userId, authenticatedIsGuest: false, identifyEventIds: h.state.enabled });
  const cleanup = rendered.effects.map((effect) => effect()).filter((value) => typeof value === "function");
  await h.initialize();
  await new Promise((resolve) => setImmediate(resolve));
  return { Analytics, cleanup };
}

for (const userId of [null, 123]) {
  test(`signup navigation has exact safe properties and one ID under StrictMode effects, user=${userId}`, () => {
    const h = harness();
    const Signup = h.load("src/app/login/SignupPageViewed.tsx").default;
    const api = h.load("src/lib/analytics/browserCapture.ts");
    const { result, effects } = h.render(Signup, { enabled: true, userId });
    assert.equal(result, null);
    effects.forEach((effect) => effect());
    effects.forEach((effect) => effect());
    const received: any[] = [];
    api.installBrowserCaptureSink((event: any) => received.push(event));
    assert.equal(received.length, 1);
    const properties = received[0].properties;
    assert.match(properties.event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(new Date(properties.occurred_at).toISOString(), properties.occurred_at);
    assert.deepEqual(plain(received[0]), { event: "signup_page_viewed", properties: {
      page_path: "/login", auth_state: userId === null ? "anonymous" : "authenticated", screen_mode: "unknown",
      source: "web", event_id: properties.event_id, user_id: userId === null ? null : String(userId),
      workspace_id: null, board_id: null, is_seeded: null, utm_source: null, utm_medium: null, utm_campaign: null,
      initial_referrer: null, attribution_status: "unknown", occurred_at: properties.occurred_at, environment: "test", account_category: null,
    } });
    h.render(Signup, { enabled: true, userId }).effects.forEach((effect) => effect());
    assert.equal(received.length, 1);
    h.render(Signup, { enabled: true, userId }, true).effects.forEach((effect) => effect());
    assert.equal(received.length, 2);
    assert.notEqual(received[1].properties.event_id, properties.event_id);
  });
}

test("queue drains once, captures immediately afterward, and cleanup preserves the newer sink", () => {
  const h = harness();
  const api = h.load("src/lib/analytics/browserCapture.ts");
  const event = { event: "signup_page_viewed", properties: { event_id: randomUUID() } };
  api.captureBrowserEvent(event);
  const first: any[] = [], second: any[] = [];
  const cleanup = api.installBrowserCaptureSink((value: any) => first.push(value));
  api.installBrowserCaptureSink((value: any) => second.push(value));
  cleanup();
  api.captureBrowserEvent(event);
  assert.deepEqual(first, [event]);
  assert.deepEqual(second, [event]);
});

for (const candidates of [[6, 985], [], null]) {
  test(`anonymous server gate only enables Everyone, candidates=${JSON.stringify(candidates)}`, async () => {
    const h = harness();
    h.state.candidates = candidates;
    const page = await h.load("src/app/login/page.tsx").default();
    const tracker = page.props.children[0];
    assert.equal(tracker.props.enabled, candidates === null);
    assert.equal(tracker.props.userId, null);
    assert.deepEqual(h.flagCalls, [[flag]]);
    h.render(tracker.type, tracker.props).effects.forEach((effect) => effect());
    const received: any[] = [];
    h.load("src/lib/analytics/browserCapture.ts").installBrowserCaptureSink((event: any) => received.push(event));
    assert.equal(received.length, candidates === null ? 1 : 0);
    assert.deepEqual(plain(page.props.children.slice(1).map((child: any) => child.type)), ["UTMCookieHandler", "LoginComponent"]);
  });
}

for (const enabled of [false, true]) {
  for (const eligible of [false, true]) {
    test(`signed-in server gate requires user flag=${enabled} and eligibility=${eligible}`, async () => {
      const h = harness();
      Object.assign(h.state, { enabled, eligible, session: { id: 123 } });
      const page = await h.load("src/app/login/page.tsx").default();
      assert.deepEqual(plain(page.props.children[0].props), { enabled: enabled && eligible, userId: 123 });
      assert.deepEqual(h.flagCalls, [[flag, 123]]);
    });
  }
}

test("essential consent neither queues a signup event nor initializes PostHog", async () => {
  const h = harness();
  h.state.consent = "essential";
  h.render(h.load("src/app/login/SignupPageViewed.tsx").default, { enabled: true, userId: null }).effects.forEach((effect) => effect());
  const received: any[] = [];
  h.load("src/lib/analytics/browserCapture.ts").installBrowserCaptureSink((event: any) => received.push(event));
  await startAnalytics(h);
  assert.equal(h.config, undefined);
  assert.deepEqual(received, []);
});

test("PostHog drains only after identity reconciliation and uses the navigation ID as capture UUID", async () => {
  const h = harness();
  h.render(h.load("src/app/login/SignupPageViewed.tsx").default, { enabled: true, userId: null }).effects.forEach((effect) => effect());
  assert.equal(h.captures.length, 0);
  let reconciled = false;
  h.posthog.set_config = () => { reconciled = true; };
  const originalCapture = h.posthog.capture;
  h.posthog.capture = (...args: any[]) => { assert.ok(reconciled); return originalCapture(...args); };
  await startAnalytics(h);
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0][0], "signup_page_viewed");
  assert.deepEqual(plain(h.captures[0][2]), { uuid: h.captures[0][1].event_id });
  h.config.loaded(h.posthog);
  assert.equal(h.captures.length, 1);
});

test("queued events are discarded after an account change or consent withdrawal", async () => {
  for (const reason of ["account", "consent"]) {
    const h = harness();
    h.render(h.load("src/app/login/SignupPageViewed.tsx").default, { enabled: true, userId: 123 }).effects.forEach((effect) => effect());
    await startAnalytics(h, 234);
    assert.equal(h.captures.length, 0);
    if (reason === "consent") h.state.consent = "essential";
    h.load("src/lib/analytics/browserCapture.ts").captureBrowserEvent({ event: "signup_page_viewed", properties: { user_id: reason === "consent" ? "234" : "123", event_id: randomUUID() } });
    assert.equal(h.captures.length, 0);
  }
});

test("identify receives event ID and source only with signed-in flag enabled, and reads flag changes at send time", async () => {
  const h = harness();
  h.state.enabled = false;
  const { Analytics } = await startAnalytics(h, 123);
  const beforeSend = h.config.before_send;
  const event = () => ({ event: "$identify", uuid: randomUUID(), properties: { preserved: true } });
  const off = event();
  assert.equal(beforeSend(off), off);
  assert.deepEqual(off.properties, { preserved: true });
  h.render(Analytics, { authenticatedUserId: 123, authenticatedIsGuest: false, identifyEventIds: true }).effects[0]();
  const on = event();
  assert.equal(beforeSend(on), on);
  assert.deepEqual(on.properties, { preserved: true, event_id: on.uuid, source: "web" });
  const other = { ...event(), event: "$pageview" };
  beforeSend(other);
  assert.deepEqual(other.properties, { preserved: true });
  h.render(Analytics, { authenticatedUserId: 123, authenticatedIsGuest: false, identifyEventIds: false }).effects[0]();
  const offAgain = event();
  beforeSend(offAgain);
  assert.deepEqual(offAgain.properties, { preserved: true });
});

test("anonymous identify stays untouched even with the flag enabled", async () => {
  const h = harness();
  await startAnalytics(h);
  const event = { event: "$identify", uuid: randomUUID(), properties: {} };
  h.config.before_send(event);
  assert.deepEqual(event.properties, {});
});

test("identify prop defaults off for callers without the switch", async () => {
  const h = harness();
  const Analytics = h.load("src/components/Analytics/PostHogAnalytics.tsx").default;
  h.render(Analytics, { authenticatedUserId: 123, authenticatedIsGuest: false }).effects.forEach((effect) => effect());
  await h.initialize();
  await new Promise((resolve) => setImmediate(resolve));
  const event = { event: "$identify", uuid: randomUUID(), properties: {} };
  h.config.before_send(event);
  assert.deepEqual(event.properties, {});
});

for (const failure of ["anonymous-flag", "signed-in-flag", "eligibility"]) {
  test(`analytics ${failure} failure does not prevent the existing login screen rendering`, async () => {
    const h = harness();
    h.state.failure = failure === "eligibility" ? "eligibility" : "flag";
    h.state.session = failure === "anonymous-flag" ? null : { id: 123 };
    const page = await h.load("src/app/login/page.tsx").default();
    assert.equal(page.props.children[0].props.enabled, false);
    assert.deepEqual(plain(page.props.children.slice(1).map((child: any) => child.type)), ["UTMCookieHandler", "LoginComponent"]);
  });
}

for (const session of [null, { id: 123 }]) {
  for (const enabled of [false, true]) {
    test(`layout passes server identify flag before the provider, user=${session?.id ?? "anonymous"}, enabled=${enabled}`, async () => {
      const h = harness();
      Object.assign(h.state, { session, enabled });
      const layout = await h.load("src/app/layout.tsx").default({ children: "existing-content" });
      const children = layout.props.children[1].props.children;
      const analytics = children.find((child: any) => child?.type === "PostHogAnalytics");
      assert.equal(analytics.props.identifyEventIds, session !== null && enabled);
      assert.equal(analytics.props.authenticatedUserId, session?.id ?? null);
      const provider = children.find((child: any) => child?.type === "Provider");
      assert.equal(provider.props.children, "existing-content");
      assert.ok(children.indexOf(analytics) < children.indexOf(provider));
      assert.deepEqual(h.flagCalls.filter(([key]: [string]) => key === flag), session === null ? [] : [[flag, 123]]);
    });
  }
}

test("layout starts identify lookup concurrently and fails closed without blocking content", async () => {
  const h = harness();
  h.state.session = { id: 123 };
  let rejectFlag!: (error: Error) => void;
  const started: string[] = [];
  h.mocks["@/lib/flags"].isFeatureEnabled = (key: string) => {
    if (key !== flag) return Promise.resolve(false);
    started.push("flag");
    return new Promise((_resolve, reject) => { rejectFlag = reject; });
  };
  h.mocks["@/lib/firstScreen/serverBoardDocument"].getServerBoardDocument = async () => { started.push("board"); return null; };
  h.mocks["@/lib/firstScreen/serverInboxDocument"].getServerInboxDocument = async () => { started.push("inbox"); return null; };
  const rendering = h.load("src/app/layout.tsx").default({ children: "existing-content" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["board", "inbox", "flag"]);
  rejectFlag(Error("flag lookup failed"));
  const layout = await rendering;
  const children = layout.props.children[1].props.children;
  assert.equal(children.find((child: any) => child?.type === "PostHogAnalytics").props.identifyEventIds, false);
  assert.equal(children.find((child: any) => child?.type === "Provider").props.children, "existing-content");
});

test("identify failure isolation does not swallow an existing board document failure", async () => {
  const h = harness();
  h.state.session = { id: 123 };
  h.mocks["@/lib/firstScreen/serverBoardDocument"].getServerBoardDocument = async () => { throw Error("board lookup failed"); };
  await assert.rejects(h.load("src/app/layout.tsx").default({ children: "existing-content" }), /board lookup failed/);
});
