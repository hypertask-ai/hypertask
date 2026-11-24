const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const key = "htpr-9286-signout-page";
const googleUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&state=fixture";

async function openPage({ session = { userId: 182 }, enabled = true } = {}) {
  const calls = { flags: [] };
  const load = loader({
    "next/headers": { headers: async () => new Headers() },
    "next/navigation": { notFound: () => { throw new Error("not found"); } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => session },
    "@/lib/flags": { isFeatureEnabled: async (flag, userId) => { calls.flags.push([flag, userId]); return enabled; } },
    "@/lib/flags/keys": { HTPR_9286_SIGNOUT_PAGE_FLAG: key },
    "./SignOutScreen": { default: "screen" },
  });
  try { calls.result = await load("src/app/signout/page.tsx").default(); }
  catch (error) { calls.error = error; }
  return calls;
}

test("the flag shows the sign-out screen and hides it when off", async () => {
  const signedIn = await openPage();
  assert.equal(signedIn.error, undefined);
  assert.equal(signedIn.result.type, "screen");
  assert.deepEqual(signedIn.result.props, {});
  assert.deepEqual(signedIn.flags, [[key, 182]]);
  const signedOut = await openPage({ session: null });
  assert.deepEqual(signedOut.result.props, {});
  assert.deepEqual(signedOut.flags, [[key, 0]]);
  assert.equal((await openPage({ enabled: false })).error.message, "not found");
  assert.equal((await openPage({ session: null, enabled: false })).error.message, "not found");
});

function screen({ signOutResults = [true], signInUrl = googleUrl } = {}) {
  const view = mount();
  const events = { signouts: 0, options: [], social: [], assigned: [] };
  const load = loader({
    "lucide-react": { LogOut: () => null },
    "@/hooks/MultiPages/HTC/useSignout": {
      useSignout: (_handler, options) => {
        events.options.push(options);
        return { handleHardReset: async () => signOutResults[Math.min(events.signouts++, signOutResults.length - 1)] };
      },
    },
    "@/lib/auth/betterAuthClient": { authClient: { signIn: { social: async (args) => {
      events.social.push(args);
      return { data: signInUrl ? { url: signInUrl, redirect: false } : null };
    } } } },
    "@/lib/configs/auth.config": { default: { redirect: { afterLogin: "/" } } },
  });
  const Screen = load("src/app/signout/SignOutScreen.tsx").default;
  const buttons = () => Array.from(view.container.querySelectorAll("button"));
  const settle = () => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  let realWindow;
  return {
    events,
    buttons,
    text: () => view.container.textContent,
    async mountScreen() {
      await React.act(async () => view.render(React.createElement(Screen)));
      await settle();
    },
    async click(index) {
      await React.act(async () => buttons()[index].click());
      await settle();
    },
    recordAssign() {
      realWindow = global.window;
      global.window = {
        document: realWindow.document,
        location: { href: realWindow.location.href, assign: (url) => { events.assigned.push(String(url)); } },
        addEventListener: (...args) => realWindow.addEventListener(...args),
        removeEventListener: (...args) => realWindow.removeEventListener(...args),
        dispatchEvent: (...args) => realWindow.dispatchEvent(...args),
      };
    },
    close() {
      if (realWindow) global.window = realWindow;
      view.close();
    },
  };
}

test("opening the page signs this browser out once and then offers Sign in again", async () => {
  const s = screen();
  try {
    await s.mountScreen();
    assert.equal(s.events.signouts, 1);
    assert.ok(s.events.options.every((options) => options.redirectTo === null));
    assert.ok(s.text().includes("You are signed out"));
    assert.deepEqual(s.buttons().map((button) => button.textContent), ["Sign in again"]);
  } finally { s.close(); }
});

test("Sign in again opens Google's account chooser, or the login page when Google returns nothing", async () => {
  for (const signInUrl of [googleUrl, null]) {
    const s = screen({ signInUrl });
    try {
      await s.mountScreen();
      s.recordAssign();
      await s.click(0);
      if (signInUrl) {
        assert.equal(s.events.social[0].provider, "google");
        assert.equal(s.events.social[0].disableRedirect, true);
        const url = new URL(s.events.assigned[0]);
        assert.equal(url.origin, "https://accounts.google.com");
        assert.equal(url.searchParams.get("prompt"), "select_account");
        assert.equal(url.searchParams.get("state"), "fixture");
      } else {
        assert.deepEqual(s.events.assigned, ["/login"]);
      }
    } finally { s.close(); }
  }
});

test("a failed sign-out stays on the page until Try again succeeds", async () => {
  const s = screen({ signOutResults: [false, true] });
  try {
    await s.mountScreen();
    assert.ok(s.text().includes("Could not sign you out"));
    assert.deepEqual(s.buttons().map((button) => button.textContent), ["Try again"]);
    await s.click(0);
    assert.equal(s.events.signouts, 2);
    assert.ok(s.text().includes("You are signed out"));
  } finally { s.close(); }
});

test("the shared sign-out leaves for login unless this page asks it to stay", async () => {
  for (const redirectTo of [undefined, null]) {
    const view = mount();
    const oldStorage = global.localStorage;
    const oldWindow = global.window;
    const toasts = [];
    const locations = [];
    global.localStorage = { clear: () => {} };
    global.window = {
      document: oldWindow.document,
      location: { get href() { return "https://app.hypertask.ai/signout"; }, set href(value) { locations.push(String(value)); } },
    };
    const toast = Object.assign((message) => toasts.push(message), { error: () => {} });
    try {
      const load = loader({
        "react-hot-toast": { default: toast },
        "@/lib/state": { useResetRecoilState: () => () => {} },
        "@tanstack/react-query": { useQueryClient: () => ({ clear: () => {} }) },
        "@/hooks/General/useFcmToken": { default: () => ({}) },
        axios: { default: { delete: async () => {} } },
        "@/lib/constants/utm": { ALL_UTM_COOKIE_NAMES: [] }, "@/store": {},
        "@/lib/localReadModels/clear": { clearAllLocalReadModels: async () => true },
        "@/lib/auth/accounts": { signOutAllAccounts: async () => true },
      });
      let reset;
      function Probe() {
        const options = redirectTo === undefined ? undefined : { redirectTo };
        reset = load("src/hooks/MultiPages/HTC/useSignout.ts").useSignout(undefined, options).handleHardReset;
        return null;
      }
      await view.render(React.createElement(Probe));
      assert.equal(await reset(), true);
      assert.deepEqual(locations, redirectTo === null ? [] : ["/login"]);
      assert.deepEqual(toasts, redirectTo === null ? [] : ["Signed out successfully!"]);
    } finally {
      global.window = oldWindow;
      global.localStorage = oldStorage;
      view.close();
    }
  }
});

test("the sign-out still asks the server, so the HttpOnly cookies go, even with no live session", async () => {
  for (const serverAccepts of [true, false]) {
    const view = mount();
    const oldStorage = global.localStorage;
    const oldWindow = global.window;
    const serverCalls = [];
    let storageCleared = false;
    global.localStorage = { clear: () => { storageCleared = true; } };
    global.window = {
      document: oldWindow.document,
      location: { get href() { return "https://app.hypertask.ai/signout"; }, set href() { throw new Error("this page must not navigate"); } },
    };
    try {
      const load = loader({
        "react-hot-toast": { default: Object.assign(() => {}, { error: () => {} }) },
        "@/lib/state": { useResetRecoilState: () => () => {} },
        "@tanstack/react-query": { useQueryClient: () => ({ clear: () => {} }) },
        "@/hooks/General/useFcmToken": { default: () => ({}) },
        axios: { default: { delete: async () => {} } },
        "@/lib/constants/utm": { ALL_UTM_COOKIE_NAMES: [] }, "@/store": {},
        "@/lib/localReadModels/clear": { clearAllLocalReadModels: async () => true },
        "@/lib/auth/accounts": { signOutAllAccounts: async () => { serverCalls.push(Date.now()); return serverAccepts; } },
      });
      let reset;
      function Probe() {
        reset = load("src/hooks/MultiPages/HTC/useSignout.ts").useSignout(undefined, { redirectTo: null }).handleHardReset;
        return null;
      }
      await view.render(React.createElement(Probe));
      assert.equal(await reset(), serverAccepts);
      assert.equal(serverCalls.length, 1);
      assert.equal(storageCleared, serverAccepts);
    } finally {
      global.window = oldWindow;
      global.localStorage = oldStorage;
      view.close();
    }
  }
});

function loadProxy(user) {
  return loader({
    "./utils/edgeHelpers": { isValidUser: () => (user ? { isValid: true, user } : { isValid: false, user: null }) },
    "./utils/serverActions": { isMobileDevice: () => false },
    "./utils/helperFunctions/helperFunctions": { canAccessTrialPage: () => false },
    "@/lib/auth/safeReturnTo": { parseSafeReturnTo: () => null },
    "@/lib/auth/sessionEdge": { verifySessionEdge: async () => (user ? { id: user.id } : null) },
    "@/lib/net/contentEncoding": { refusedContentEncoding: () => undefined },
    "@/lib/auth/agentCookieBridgeRoutes": { isAgentCookieBridgeRequestAllowed: () => false },
    "@/lib/telemetry/signupAnalytics": { recordServerCapture: () => {} },
    "@/lib/auth/sessionRevocation": { isSessionTokenRevoked: async () => false },
    "@/lib/auth/cookieIdentity": { verifyCookieIdentity: async () => ({ status: "ok" }) },
    "@/lib/routing/detailWithoutTicket": { detailWithoutTicketRedirect: () => null },
    "@/lib/tutorial/keyboardShortcutTutorial": {
      isKeyboardShortcutTutorialPath: () => false,
      hasKeyboardShortcutTutorialQuery: () => false,
      removeKeyboardShortcutTutorialQuery: () => {},
    },
  })("src/proxy.ts").default;
}

test("the sign-out page needs a signed-in browser", async () => {
  const { NextRequest } = require("next/server");
  const open = (proxy, path, cookie) => proxy(new NextRequest(`https://app.hypertask.ai${path}`, {
    headers: cookie ? { cookie } : {},
  }));
  const visitor = await open(loadProxy(null), "/signout");
  assert.equal(new URL(visitor.headers.get("location")).pathname, "/login");
  const user = { id: 182, UserSetting: { onboardingTourStatus: true } };
  const cookie = "nookies_user=account; ht_session=session";
  const staying = await open(loadProxy(user), "/signout", cookie);
  assert.equal(staying.status, 200);
  assert.equal(staying.headers.get("location"), null);
  assert.equal(staying.headers.get("x-middleware-next"), "1");
});

test("the sign-out flag is on for everyone", () => {
  const flag = loader()("src/lib/flags/definitions/htpr-9286-signout-page.ts");
  assert.equal(flag.HTPR_9286_SIGNOUT_PAGE_FLAG, key);
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.kind, "bugfix");
});
