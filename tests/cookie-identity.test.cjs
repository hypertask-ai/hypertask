// HTPR-3979: nookies_user is client-writable, so an `id` in it is a claim, not
// proof. Every gate that reads identity from cookies must reject a claim with no
// matching signed ht_session — otherwise a forged {id: victimId} acts as that
// user. This is the invariant behind both the /api gate and the /oauth gate in
// src/proxy.ts, and behind the /oauth/authorize check that issues auth codes.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/cookie-identity-jiti-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    },
  );
  return jiti(path.join(root, relativePath));
}

const originalSessionSecret = process.env.SESSION_SECRET;
const originalJwtSecret = process.env.JWT_SECRET;
process.env.SESSION_SECRET = "cookie-identity-test-secret";
delete process.env.JWT_SECRET;

const { signSession } = loadTs("src/lib/auth/session.ts");
const { verifyCookieIdentity } = loadTs("src/lib/auth/cookieIdentity.ts");

test.after(() => {
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
  if (originalJwtSecret !== undefined) process.env.JWT_SECRET = originalJwtSecret;
});

const VICTIM = 6;
const ATTACKER = 999;
const forgedCookie = (id) =>
  JSON.stringify({ id, displayName: "Victim", email: "victim@example.com" });

test("a forged nookies_user with no session is rejected", async () => {
  const identity = await verifyCookieIdentity(forgedCookie(VICTIM), undefined);
  assert.equal(identity.status, "forged");
});

test("a forged nookies_user with a garbage session is rejected", async () => {
  const identity = await verifyCookieIdentity(forgedCookie(VICTIM), "not.asignature");
  assert.equal(identity.status, "forged");
});

test("an attacker's real session cannot vouch for another user's id", async () => {
  // The core takeover attempt: log in legitimately, then edit the cookie's id.
  const attackerSession = signSession({ id: ATTACKER, email: "attacker@example.com" });
  const identity = await verifyCookieIdentity(forgedCookie(VICTIM), attackerSession);
  assert.equal(identity.status, "forged");
});

test("a matching signed session verifies", async () => {
  const session = signSession({ id: VICTIM, email: "victim@example.com" });
  const identity = await verifyCookieIdentity(forgedCookie(VICTIM), session);
  assert.deepEqual(identity, { status: "verified", id: VICTIM });
});

test("callers that claim nothing pass through as unauthenticated", async () => {
  // Machine callers (/oauth/token, /oauth/register, webhooks) send no cookies and
  // must pass through untouched, not get redirected or 401'd.
  assert.equal((await verifyCookieIdentity(undefined, undefined)).status, "unauthenticated");
  assert.equal((await verifyCookieIdentity("", undefined)).status, "unauthenticated");
  assert.equal((await verifyCookieIdentity("{}", undefined)).status, "unauthenticated");
  assert.equal(
    (await verifyCookieIdentity(JSON.stringify({ id: null }), undefined)).status,
    "unauthenticated",
  );
});

test("a hand-edited or corrupt cookie fails closed", async () => {
  // Not "unauthenticated": we want the bad cookie actively cleared, not ignored.
  assert.equal((await verifyCookieIdentity("not json", undefined)).status, "forged");
  const session = signSession({ id: VICTIM, email: "victim@example.com" });
  for (const bad of [true, [], {}, "abc"]) {
    const identity = await verifyCookieIdentity(
      JSON.stringify({ id: bad, displayName: "x", email: "x@x" }),
      session,
    );
    assert.notEqual(identity.status, "verified", `id ${JSON.stringify(bad)} must not verify`);
  }
});

test("a numeric-string id is honoured only when the signed session agrees", async () => {
  // Coercion must not become a bypass: "6" matching a session for 6 is fine,
  // "6" against a session for someone else is not.
  const victimSession = signSession({ id: VICTIM, email: "victim@example.com" });
  const attackerSession = signSession({ id: ATTACKER, email: "attacker@example.com" });
  const claim = JSON.stringify({ id: String(VICTIM), displayName: "x", email: "x@x" });

  assert.equal((await verifyCookieIdentity(claim, victimSession)).status, "verified");
  assert.equal((await verifyCookieIdentity(claim, attackerSession)).status, "forged");
});
