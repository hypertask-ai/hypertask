const test = require("node:test");
const assert = require("node:assert/strict");
const { loader } = require("./helpers/htpr-7260-ui.cjs");
const { NextResponse } = require("next/server");

test("force-signout expires every browser authentication cookie", async () => {
  const load = loader({
    "next/server": { NextResponse },
    "@/lib/auth/sessionRevocation": { revokeSessionToken: async () => {} },
    "@/lib/auth/betterAuth": { auth: { api: { signOut: async () => NextResponse.json({ success: true }) } } },
  });
  const names = ["ht_session", "nookies_user", "better-auth.session_token", "__Secure-better-auth.session_token_multi-fixture", "better-auth.session_data.0"];
  const response = await load("src/app/api/auth/force-signout/route.ts").POST(new Request("http://localhost/api/auth/force-signout", {
    method: "POST", headers: { cookie: names.map(name => `${name}=fixture`).join("; ") },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { browserCookiesCleared: true, serverSessionsRevoked: true });
  for (const name of names) {
    assert.equal(response.cookies.get(name)?.value, "");
    assert.equal(response.cookies.get(name)?.maxAge, 0);
  }
});
