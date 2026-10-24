const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loader, mount, React } = require("./helpers/htpr-7260-ui.cjs");
const { NextResponse } = require("next/server");
const cookieHelpers = require("better-auth/cookies");

const read = file => fs.readFileSync(file, "utf8");

test("Google explicitly opens the chooser; normal Google sign-in remains unrestricted", async () => {
  const source = read("src/lib/auth/betterAuth.ts");
  const block = source.match(/socialProviders:\s*\{\s*google:\s*\{([\s\S]*?)\n\s*\}/)?.[1];
  assert.ok(block);
  assert.match(block, /prompt:\s*["']select_account["']/);
  assert.doesNotMatch(block, /hostedDomain|loginHint|disableSignIn|disableSignUp/);
  const { google } = await import("@better-auth/core/social-providers");
  const prompt = block.match(/prompt:\s*["']([^"']+)["']/)[1];
  const provider = google({ clientId: "fixture", clientSecret: "fixture", prompt });
  const url = await provider.createAuthorizationURL({ state: "fixture", codeVerifier: "fixture", redirectURI: "https://app.hypertask.ai/api/auth/callback/google" });
  assert.equal(url.searchParams.get("prompt"), "select_account");
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
      return { ok: true };
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

for (const otherAccount of [false, true]) {
  test(`existing Sign out clears the browser with ${otherAccount ? "multiple" : "one"} remembered account`, async () => {
    const view = mount();
    let signouts = 0;
    const current = { id: 182, name: "Account 182" };
    const accounts = [current, ...(otherAccount ? [{ id: 6, name: "Account 6", sessionToken: "fixture" }] : [])];
    const load = loader({
      "@/components/Common/CommonModalComponents": { ModalContainerCustom: ({ children }) => React.createElement("div", null, children), ModalHeaderComp: () => null },
      reactstrap: { ModalBody: ({ children }) => React.createElement("div", null, children) },
      "@/hooks/MultiPages/HTC/useSignout": { useSignout: () => ({ handleHardReset: async () => { signouts++; return true; } }) },
      "@/lib/auth/accounts": {
        getActiveAccountId: () => current.id, getCurrentAccount: () => current,
        listAccountsWithStatus: async () => ({ accounts, ok: true }), mergeCurrentAccount: list => list,
      },
    });
    try {
      await React.act(async () => view.render(React.createElement(load("src/components/Modals/SignOut/SignOutModal.tsx").default, { closeHandler: () => {} })));
      const primary = Array.from(view.container.querySelectorAll("button")).find(button => button.textContent === "Sign out Account 182");
      assert.ok(primary);
      await React.act(async () => primary.click());
      assert.equal(signouts, 1);
      assert.equal(view.container.textContent.includes("You’ll switch to"), false);
    } finally { view.close(); }
  });
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

test("forced sign-out still clears every remembered browser cookie when Better Auth is unavailable", async () => {
  const load = loader({
    "next/server": { NextResponse }, "better-auth/cookies": cookieHelpers,
    "@/lib/auth/sessionRevocation": { revokeSessionToken: async () => {} },
    "@/lib/auth/betterAuth": { auth: { api: { signOut: async () => { throw new Error("fixture outage"); } } } },
  });
  const names = ["better-auth.session_token", "__Secure-better-auth.session_token_multi-fixture", "better-auth.session_data.0", "ht_session", "nookies_user"];
  const response = await load("src/app/api/auth/force-signout/route.ts").POST(new Request("http://localhost/api/auth/force-signout", { method: "POST", headers: { cookie: names.map(name => `${name}=fixture`).join("; ") } }));
  assert.equal(response.status, 200);
  for (const name of names) assert.equal(response.cookies.get(name)?.maxAge, 0);
});
