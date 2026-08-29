// HTPR-4164: one-click unsubscribe. The token is handed to mail providers, who
// POST the URL unattended to satisfy Gmail/Yahoo's one-click rule. So it must
// grant exactly one power — silence this address — and nothing else.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/unsubscribe-jiti-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

process.env.SESSION_SECRET = "unsubscribe-test-secret";
process.env.NEXT_PUBLIC_BASEURL = "https://app.hypertask.ai";

const {
  createUnsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeHeaders,
  unsubscribeUrl,
} = loadTs("src/lib/email/unsubscribe.ts");

test("a token round-trips to the user it was minted for", () => {
  const token = createUnsubscribeToken(6, "Valentin.Yeo@Gmail.com");
  assert.deepEqual(verifyUnsubscribeToken(token), {
    userId: 6,
    email: "valentin.yeo@gmail.com",
  });
});

test("a tampered payload is rejected", () => {
  // The whole security model: without this, editing uid in the payload silences
  // anyone you like.
  const token = createUnsubscribeToken(6, "a@b.com");
  const [payload, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ uid: 999, email: "a@b.com" })).toString(
    "base64url",
  );

  assert.equal(verifyUnsubscribeToken(`${forged}.${signature}`), null);
  assert.equal(verifyUnsubscribeToken(`${payload}.${signature}x`), null);
  assert.equal(verifyUnsubscribeToken(`${payload}`), null);
  assert.equal(verifyUnsubscribeToken("garbage"), null);
  assert.equal(verifyUnsubscribeToken(""), null);
  assert.equal(verifyUnsubscribeToken(null), null);
});

test("a token signed with a different secret is rejected", () => {
  const token = createUnsubscribeToken(6, "a@b.com");
  const original = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = "some-other-secret";
    const other = loadTs("src/lib/email/unsubscribe.ts");
    assert.equal(other.verifyUnsubscribeToken(token), null);
  } finally {
    process.env.SESSION_SECRET = original;
  }
});

test("the headers are exactly what one-click requires", () => {
  const headers = unsubscribeHeaders(6, "a@b.com");
  assert.ok(headers["List-Unsubscribe"].startsWith("<https://"));
  assert.ok(headers["List-Unsubscribe"].endsWith(">"));
  // Without this exact value providers show a two-step flow instead of one-click.
  assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("no headers when there is no user to unsubscribe", () => {
  // Better to send without the header than to send a token that means nothing.
  assert.equal(unsubscribeHeaders(null, "a@b.com"), undefined);
  assert.equal(unsubscribeHeaders(6, null), undefined);
  assert.equal(unsubscribeHeaders(undefined, undefined), undefined);
});

test("the url is absolute and carries an encoded token", () => {
  const url = unsubscribeUrl(6, "a+tag@b.com");
  assert.ok(url.startsWith("https://app.hypertask.ai/api/notifications/unsubscribe?token="));
  const token = decodeURIComponent(new URL(url).searchParams.get("token"));
  assert.deepEqual(verifyUnsubscribeToken(token), { userId: 6, email: "a+tag@b.com" });
});
