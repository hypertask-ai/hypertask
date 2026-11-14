const test = require("node:test");
const assert = require("node:assert/strict");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");

const key = "htpr-9286-signout-page";

async function openPage({ session = { userId: 182 }, enabled = true } = {}) {
  const calls = { flags: [] };
  const load = loader({
    "next/headers": { headers: async () => new Headers() },
    "next/navigation": {
      redirect: url => { throw Object.assign(new Error("redirect"), { url }); },
      notFound: () => { throw new Error("not found"); },
    },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => session },
    "@/lib/flags": { isFeatureEnabled: async (flag, userId) => { calls.flags.push([flag, userId]); return enabled; } },
    "@/lib/flags/keys": { HTPR_9286_SIGNOUT_PAGE_FLAG: key },
    "./SignOutScreen": { default: "screen" },
  });
  try {
    calls.result = await load("src/app/signout/page.tsx").default();
  } catch (error) {
    calls.error = error;
  }
  return calls;
}

test("flag on shows the sign-out screen for a signed-in account", async () => {
  const opened = await openPage();
  assert.equal(opened.error, undefined);
  assert.equal(opened.result.type, "screen");
  assert.deepEqual(opened.flags, [[key, 182]]);
});

test("flag off shows not found and a visitor without a session goes to login", async () => {
  assert.equal((await openPage({ enabled: false })).error.message, "not found");
  const visitor = await openPage({ session: null });
  assert.equal(visitor.error.url, "/login");
  assert.deepEqual(visitor.flags, []);
});

function screen({ signOutResults = [true], signInUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture&state=fixture" } = {}) {
  const view = mount();
  const events = { signouts: 0, options: [], social: [], assigned: [] };
  const load = loader({
    "lucide-react": { LogOut: () => null },
    "@/hooks/MultiPages/HTC/useSignout": {
      useSignout: (handler, options) => {
        events.options.push(options);
        return { handleHardReset: async () => signOutResults[Math.min(events.signouts++, signOutResults.length - 1)] };
      },
    },
    "@/lib/auth/betterAuthClient": { authClient: { signIn: { social: async args => { events.social.push(args); return { data: signInUrl ? { url: signInUrl, redirect: false } : null }; } } } },
    "@/lib/configs/auth.config": { default: { redirect: { afterLogin: "/" } } },
  });
  const Screen = load("src/app/signout/SignOutScreen.tsx").default;
  const buttons = () => Array.from(view.container.querySelectorAll("button"));
  const text = () => view.container.textContent;
  const settle = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return {
    view, events, buttons, text, settle,
    mountScreen: async () => { await React.act(async () => view.render(React.createElement(Screen))); await settle(); },
    click: async index => { await React.act(async () => buttons()[index].click()); await settle(); },
  };
}

test("opening the page signs out once without leaving the page, then offers Sign in again", async () => {
  const s = screen();
  try {
    await s.mountScreen();
    assert.equal(s.events.signouts, 1);
    assert.ok(s.events.options.length > 0);
    assert.ok(s.events.options.every(options => options.redirectTo === null));
    assert.ok(s.text().includes("You are signed out"));
    assert.deepEqual(s.buttons().map(button => button.textContent), ["Sign in again"]);
  } finally { s.view.close(); }
});

function trackAssign(events) {
  const realWindow = window;
  const location = new Proxy(realWindow.location, {
    get(target, key) {
      if (key === "assign") return (url) => { events.assigned.push(String(url)); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  global.window = new Proxy(realWindow, {
    get(target, key) {
      if (key === "location") return location;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return () => { global.window = realWindow; };
}

test("Sign in again sends the person to Google with the account chooser", async () => {
  const s = screen();
  const restore = [];
  try {
    await s.mountScreen();
    restore.push(trackAssign(s.events));
    await s.click(0);
    assert.equal(s.events.social.length, 1);
    assert.equal(s.events.social[0].provider, "google");
    assert.equal(s.events.social[0].disableRedirect, true);
    assert.equal(s.events.assigned.length, 1);
    const url = new URL(s.events.assigned[0]);
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("prompt"), "select_account");
    assert.equal(url.searchParams.get("state"), "fixture");
  } finally {
    restore.forEach((undo) => undo());
    s.view.close();
  }
});

test("Sign in again falls back to the login page when no Google address comes back", async () => {
  const s = screen({ signInUrl: null });
  const restore = [];
  try {
    await s.mountScreen();
    restore.push(trackAssign(s.events));
    await s.click(0);
    assert.deepEqual(s.events.assigned, ["/login"]);
  } finally {
    restore.forEach((undo) => undo());
    s.view.close();
  }
});

test("a failed sign-out says so and Try again signs out a second time", async () => {
  const s = screen({ signOutResults: [false, true] });
  try {
    await s.mountScreen();
    assert.ok(s.text().includes("Could not sign you out"));
    assert.deepEqual(s.buttons().map(button => button.textContent), ["Try again"]);
    await s.click(0);
    assert.equal(s.events.signouts, 2);
    assert.ok(s.text().includes("You are signed out"));
  } finally { s.view.close(); }
});

test("the shared sign-out hook stays on the page when asked not to redirect", async () => {
  for (const redirectTo of [undefined, null]) {
    const view = mount();
    const oldStorage = global.localStorage;
    const toasts = [];
    global.localStorage = { clear: () => {} };
    const toast = Object.assign(message => toasts.push(message), { error: () => {} });
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
        reset = load("src/hooks/MultiPages/HTC/useSignout.ts").useSignout(undefined, redirectTo === undefined ? undefined : { redirectTo }).handleHardReset;
        return null;
      }
      view.render(React.createElement(Probe));
      const before = window.location.href;
      assert.equal(await reset(), true);
      if (redirectTo === null) {
        assert.equal(window.location.href, before);
        assert.deepEqual(toasts, []);
      } else {
        assert.deepEqual(toasts, ["Signed out successfully!"]);
      }
    } finally { global.localStorage = oldStorage; view.close(); }
  }
});

test("a signed-in account that has not finished onboarding can still open the sign-out page", async () => {
  const { NextRequest } = require("next/server");
  const user = { id: 182, UserSetting: { onboardingTourStatus: false } };
  const proxy = loader({
    "./utils/edgeHelpers": { isValidUser: () => ({ isValid: true, user }) },
    "./utils/serverActions": { isMobileDevice: () => false },
    "./utils/helperFunctions/helperFunctions": { canAccessTrialPage: () => false },
    "@/lib/auth/safeReturnTo": { parseSafeReturnTo: () => null },
    "@/lib/auth/sessionEdge": { verifySessionEdge: async () => ({ id: user.id }) },
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
  const headers = { cookie: "nookies_user=account; ht_session=session" };
  const open = (path) => proxy(new NextRequest(`https://app.hypertask.ai${path}`, { headers }));
  const signout = await open("/signout");
  assert.equal(signout.status, 200);
  assert.equal(signout.headers.get("location"), null);
  assert.equal(signout.headers.get("x-middleware-next"), "1");
  const inbox = await open("/inbox");
  assert.equal(new URL(inbox.headers.get("location")).pathname, "/onboarding");
});

test("the sign-out flag is ticket-specific and goes live for everyone", () => {
  const flag = loader()("src/lib/flags/definitions/htpr-9286-signout-page.ts");
  assert.equal(flag.HTPR_9286_SIGNOUT_PAGE_FLAG, key);
  assert.equal(flag.default.key, key);
  assert.equal(flag.default.defaultMode, "EVERYONE");
});
