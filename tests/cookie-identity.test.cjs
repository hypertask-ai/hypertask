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
  assert.equal((await verifyCookieIdentity(undefined, undefined)).status, "unauthenticated");
  assert.equal((await verifyCookieIdentity("", undefined)).status, "unauthenticated");
  assert.equal((await verifyCookieIdentity("{}", undefined)).status, "unauthenticated");
  assert.equal(
    (await verifyCookieIdentity(JSON.stringify({ id: null }), undefined)).status,
    "unauthenticated",
  );
});

test("a hand-edited or corrupt cookie fails closed", async () => {
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
  const victimSession = signSession({ id: VICTIM, email: "victim@example.com" });
  const attackerSession = signSession({ id: ATTACKER, email: "attacker@example.com" });
  const claim = JSON.stringify({ id: String(VICTIM), displayName: "x", email: "x@x" });

  assert.equal((await verifyCookieIdentity(claim, victimSession)).status, "verified");
  assert.equal((await verifyCookieIdentity(claim, attackerSession)).status, "forged");
});
