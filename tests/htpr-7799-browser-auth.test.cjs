const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const { NextResponse } = require("next/server");
const cookieHelpers = require("better-auth/cookies");

const read = file => fs.readFileSync(file, "utf8");

test("Google OAuth initiation keeps the production provider default without a new chooser", async () => {
  const source = read("src/lib/auth/betterAuth.ts");
  const block = source.match(/socialProviders:\s*\{\s*google:\s*\{([\s\S]*?)\n\s*\}/)?.[1];
  assert.ok(block);
  assert.doesNotMatch(block, /prompt:|hostedDomain|loginHint|disableSignIn|disableSignUp/);
  const { google } = await import("@better-auth/core/social-providers");
  const provider = google({ clientId: "fixture", clientSecret: "fixture" });
  const url = await provider.createAuthorizationURL({ state: "fixture", codeVerifier: "fixture", redirectURI: "https://app.hypertask.ai/api/auth/callback/google" });
  assert.equal(url.searchParams.get("prompt"), null);
  assert.equal(url.searchParams.get("hd"), null);
  assert.ok(url.searchParams.get("scope").includes("email"));
});

for (const multi of [true, false]) {
  test(`${multi ? "multi" : "single"}-account browser sign-out revokes presented sessions and clears legacy cookies only`, async () => {
    const api = await import("better-auth/api");
    const { multiSession } = await import("better-auth/plugins");
    const { serializeSignedCookie } = require("better-call");
    const options = { baseURL: "http://localhost", plugins: [multiSession()] };
    const secret = "htpr-7799-browser-fixture";
    const authCookies = cookieHelpers.getCookies(options);
    const sessions = new Set(["current", "other-browser", ...(multi ? ["second"] : [])]);
    const cookie = async (name, value) => (await serializeSignedCookie(name, value, secret)).split(";")[0];
    const primary = authCookies.sessionToken.name;
    const names = [primary, `${primary}_multi-current`, ...(multi ? [`${primary}_multi-second`] : []), `${primary}_multi-invalid`, "better-auth.session_data", "better-auth.account_data", "ht_session", "nookies_user"];
    const cookies = [await cookie(primary, "current"), await cookie(`${primary}_multi-current`, "current"), ...(multi ? [await cookie(`${primary}_multi-second`, "second")] : []), `${primary}_multi-invalid=invalid`, "better-auth.session_data=invalid", "better-auth.account_data=invalid", "ht_session=legacy", "nookies_user=invalid"];
    const events = [];
    const load = loader({
      "next/server": { NextResponse },
      "better-auth/cookies": cookieHelpers,
      "@/lib/auth/sessionRevocation": { revokeSessionToken: async token => { assert.equal(token, "legacy"); events.push("legacy-revoked"); } },
      "@/lib/auth/betterAuth": { auth: { api: { signOut: async ({ headers }) => {
        assert.equal(headers.get("cookie"), cookies.join("; "));
        events.push("better-auth-revoked");
        return api.dispatchAuthEndpoint(api.signOut, {
          headers, request: new Request("http://localhost/api/auth/sign-out", { method: "POST", headers }),
          context: {
            options, authCookies, secret, oauthConfig: { storeStateStrategy: "database" }, logger: { error: () => {} },
            internalAdapter: {
              deleteSession: async token => sessions.delete(token),
              deleteSessions: async tokens => tokens.forEach(token => sessions.delete(token)),
            },
          },
        });
      } } } },
    });
    const response = await load("src/app/api/auth/force-signout/route.ts").POST(new Request("http://localhost/api/auth/force-signout", { method: "POST", headers: { cookie: cookies.join("; ") } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { browserCookiesCleared: true, serverSessionsRevoked: true });
    assert.deepEqual(events, ["legacy-revoked", "better-auth-revoked"]);
    assert.deepEqual([...sessions], ["other-browser"]);
    for (const name of names) {
      assert.equal(response.cookies.get(name)?.value, "", "every browser auth cookie must expire");
      assert.equal(response.cookies.get(name)?.maxAge, 0);
    }
  });
}

test("server sign-out failures are not reported as successful client sign-out", async () => {
  const oldFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: false });
    const accounts = loader({
      nookies: {}, "@/lib/configs/auth.config": {},
      "@/lib/auth/betterAuthClient": { authClient: { $store: { notify: () => {} } } },
    })("src/lib/auth/accounts.ts");
    assert.equal(await accounts.signOutAllAccounts(), false);
  } finally { global.fetch = oldFetch; }
});

test("normal sign-out invalidates client auth state and still succeeds", async () => {
  const oldFetch = global.fetch;
  const events = [];
  try {
    global.fetch = async (url, options) => {
      assert.equal(url, "/api/auth/force-signout");
      assert.equal(options.method, "POST");
      return { ok: true, json: async () => ({ browserCookiesCleared: true, serverSessionsRevoked: true }) };
    };
    const accounts = loader({
      nookies: {}, "@/lib/configs/auth.config": {},
      "@/lib/auth/betterAuthClient": { authClient: { $store: { notify: signal => events.push(signal) } } },
    })("src/lib/auth/accounts.ts");
    assert.equal(await accounts.signOutAllAccounts(), true);
    assert.deepEqual(events, ["$sessionSignal"]);
  } finally { global.fetch = oldFetch; }
});

test("account switching and current-account-only sign-out still preserve the other account", async () => {
  const oldWindow = global.window;
  const events = [];
  global.window = { location: { assign: url => events.push(url) } };
  try {
    const accounts = loader({
      nookies: {}, "@/lib/configs/auth.config": {},
      "@/lib/auth/betterAuthClient": { authClient: {
        getSession: async () => ({ data: { session: { token: "current" } } }),
        multiSession: {
          setActive: async () => ({ data: {} }),
          revoke: async ({ sessionToken }) => { assert.equal(sessionToken, "current"); return { data: { status: true } }; },
        },
      } },
    })("src/lib/auth/accounts.ts");
    assert.equal(await accounts.switchAccount("second"), true);
    assert.equal(await accounts.signOutCurrentAccount("second"), true);
    assert.deepEqual(events, ["/inbox", "/inbox"]);
  } finally { global.window = oldWindow; }
});

for (const cleared of [false, true, "blocked"]) {
  test(`local cleanup ${cleared} does not prevent browser sign-out`, async () => {
    const view = mount();
    const oldStorage = global.localStorage;
    const events = [];
    global.localStorage = { clear: () => events.push("storage-cleared") };
    const toast = Object.assign(() => {}, { error: () => {} });
    try {
      const load = loader({
        "react-hot-toast": { default: toast },
        "@/lib/state": { useResetRecoilState: () => () => {} },
        "@tanstack/react-query": { useQueryClient: () => ({ clear: () => events.push("query-cleared") }) },
        "@/hooks/General/useFcmToken": { default: () => ({}) },
        axios: { default: { delete: async () => {}, post: async () => { throw new Error("sign-out must have one authoritative endpoint"); } } },
        "@/lib/constants/utm": { ALL_UTM_COOKIE_NAMES: [] }, "@/store": {},
        "@/lib/localReadModels/clear": { clearAllLocalReadModels: async () => { assert.ok(events.includes("signed-out")); return cleared === "blocked" ? new Promise(() => {}) : cleared; } },
        "@/lib/auth/accounts": { signOutAllAccounts: async () => { events.push("signed-out"); return true; } },
      });
      let reset;
      function Probe() { reset = load("src/hooks/MultiPages/HTC/useSignout.ts").useSignout().handleHardReset; return null; }
      view.render(React.createElement(Probe));
      const previousError = console.error;
      console.error = () => {};
      try { assert.equal(await reset(), true); } finally { console.error = previousError; }
      assert.ok(events.includes("signed-out"));
      assert.ok(events.includes("storage-cleared"));
      assert.ok(events.includes("query-cleared"));
    } finally { global.localStorage = oldStorage; view.close(); }
  });
}

for (const enabled of [false, true]) {
  for (const otherAccount of [false, true]) {
    test(`Sign out uses the ${enabled ? "browser-wide" : "current-account"} action with ${otherAccount ? "multiple" : "one"} account`, async () => {
      const view = mount();
      let signouts = 0;
      const switches = [];
      const current = { id: 182, name: "Account 182" };
      const accounts = [current, ...(otherAccount ? [{ id: 6, name: "Account 6", sessionToken: "fixture" }] : [])];
      const load = loader({
        "@/components/Common/CommonModalComponents": { ModalContainerCustom: ({ children }) => React.createElement("div", null, children), ModalHeaderComp: () => null },
        reactstrap: { ModalBody: ({ children }) => React.createElement("div", null, children) },
        "@/hooks/useFlag": { useFlag: () => enabled },
        "@/hooks/MultiPages/HTC/useSignout": { useSignout: () => ({ handleHardReset: async () => { signouts++; return true; } }) },
        "@/lib/auth/accounts": {
          getActiveAccountId: () => current.id, getCurrentAccount: () => current,
          listAccountsWithStatus: async () => ({ accounts, ok: true }), mergeCurrentAccount: list => list,
          signOutCurrentAccount: async token => { switches.push(token); return true; },
        },
      });
      try {
        await React.act(async () => view.render(React.createElement(load("src/components/Modals/SignOut/SignOutModal.tsx").default, { closeHandler: () => {} })));
        const buttons = Array.from(view.container.querySelectorAll("button"));
        const signOutButtons = buttons.filter(button => button.textContent.startsWith("Sign out"));
        assert.equal(signOutButtons.length, 1);
        assert.equal(signOutButtons[0].textContent, enabled ? "Sign out of all accounts" : "Sign out Account 182");
        assert.ok(view.container.textContent.includes(enabled ? "Sign out of every account on this browser?" : "Sign out Account 182?"));
        assert.equal(view.container.textContent.includes("You’ll switch to"), false);
        await React.act(async () => signOutButtons[0].click());
        assert.equal(signouts, enabled || !otherAccount ? 1 : 0);
        assert.deepEqual(switches, !enabled && otherAccount ? ["fixture"] : []);
      } finally { view.close(); }
    });
  }
}

test("failed browser sign-out leaves local account data intact for retry", async () => {
  const view = mount();
  const oldStorage = global.localStorage;
  let cleared = false;
  global.localStorage = { clear: () => { cleared = true; } };
  const load = loader({
    "react-hot-toast": { default: { error: () => {} } },
    "@/lib/state": { useResetRecoilState: () => () => {} },
    "@tanstack/react-query": { useQueryClient: () => ({ clear: () => { cleared = true; } }) },
    "@/hooks/General/useFcmToken": { default: () => ({}) },
    axios: {}, "@/lib/constants/utm": { ALL_UTM_COOKIE_NAMES: [] }, "@/store": {},
    "@/lib/auth/accounts": { signOutAllAccounts: async () => false },
  });
  let reset;
  function Probe() { reset = load("src/hooks/MultiPages/HTC/useSignout.ts").useSignout().handleHardReset; return null; }
  try {
    view.render(React.createElement(Probe));
    assert.equal(await reset(), false);
    assert.equal(cleared, false);
  } finally { global.localStorage = oldStorage; view.close(); }
});

for (const failure of ["throw", "http-error"]) {
  test(`Better Auth failure still expires cookies, logs the failure, clears client state and navigates: ${failure}`, async (t) => {
    const errors = [];
    t.mock.method(console, "error", (...args) => errors.push(args));
    const route = loader({
      "next/server": { NextResponse }, "better-auth/cookies": cookieHelpers,
      "@/lib/auth/sessionRevocation": { revokeSessionToken: async () => {} },
      "@/lib/auth/betterAuth": { auth: { api: { signOut: async () => {
        if (failure === "throw") throw new Error("fixture outage");
        return NextResponse.json({ success: false }, { status: 500 });
      } } } },
    });
    const names = ["better-auth.session_token", "__Secure-better-auth.session_token_multi-fixture", "better-auth.session_data.0", "ht_session", "nookies_user"];
    const response = await route("src/app/api/auth/force-signout/route.ts").POST(new Request("http://localhost/api/auth/force-signout", { method: "POST", headers: { cookie: names.map(name => `${name}=fixture`).join("; ") } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.clone().json(), { browserCookiesCleared: true, serverSessionsRevoked: false });
    for (const name of names) assert.equal(response.cookies.get(name)?.maxAge, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0][0], /Better Auth session revocation failed/);

    const oldFetch = global.fetch;
    const oldStorage = global.localStorage;
    const events = [];
    const view = mount();
    const mountedWindow = global.window;
    global.fetch = async () => response.clone();
    global.window = { location: { href: "/project" } };
    global.localStorage = { clear: () => events.push("storage-cleared") };
    try {
      const accounts = loader({
        nookies: {}, "@/lib/configs/auth.config": {},
        "@/lib/auth/betterAuthClient": { authClient: { $store: { notify: () => events.push("auth-invalidated") } } },
      })("src/lib/auth/accounts.ts");
      const signout = loader({
        "react-hot-toast": { default: Object.assign(() => {}, { error: () => assert.fail("browser cleanup must not fail") }) },
        "@/lib/state": { useResetRecoilState: () => () => {} },
        "@tanstack/react-query": { useQueryClient: () => ({ clear: () => events.push("query-cleared") }) },
        "@/hooks/General/useFcmToken": { default: () => ({}) },
        axios: {}, "@/lib/constants/utm": { ALL_UTM_COOKIE_NAMES: [] }, "@/store": {},
        "@/lib/localReadModels/clear": { clearAllLocalReadModels: async () => { events.push("read-models-cleared"); return true; } },
        "@/lib/auth/accounts": accounts,
      });
      let reset;
      function Probe() { reset = signout("src/hooks/MultiPages/HTC/useSignout.ts").useSignout().handleHardReset; return null; }
      view.render(React.createElement(Probe));
      assert.equal(await reset(), true);
      assert.ok(events.includes("auth-invalidated"));
      assert.ok(events.includes("query-cleared"));
      assert.ok(events.includes("read-models-cleared"));
      assert.ok(events.includes("storage-cleared"));
      assert.equal(global.window.location.href, "/login");
    } finally { global.fetch = oldFetch; global.window = mountedWindow; global.localStorage = oldStorage; view.close(); }
  });
}
