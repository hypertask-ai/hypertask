const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/session-edge-jiti-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    },
  );
  return jiti(path.join(root, relativePath));
}

const originalSessionSecret = process.env.SESSION_SECRET;
const originalJwtSecret = process.env.JWT_SECRET;
process.env.SESSION_SECRET = "test-secret-value";
delete process.env.JWT_SECRET;

const { signSession } = loadTs("src/lib/auth/session.ts");
const { verifySessionEdge } = loadTs("src/lib/auth/sessionEdge.ts");

test.after(() => {
  if (originalSessionSecret === undefined) {
    delete process.env.SESSION_SECRET;
  } else {
    process.env.SESSION_SECRET = originalSessionSecret;
  }

  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

test("Edge verifier accepts only valid tokens made by the real signer", async () => {
  const token = signSession({ id: 6, email: "a@b.c" });
  const session = await verifySessionEdge(token);
  assert.equal(session?.id, 6);

  const [payload, signature] = token.split(".");
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lastIndex = alphabet.indexOf(signature.at(-1));
  const flippedLastChar = alphabet[lastIndex ^ 16];
  const tamperedToken = `${payload}.${signature.slice(0, -1)}${flippedLastChar}`;
  assert.equal(await verifySessionEdge(tamperedToken), null);

  assert.equal(await verifySessionEdge(signSession({ id: 6 }, -10)), null);

  process.env.SESSION_SECRET = "different-secret-value";
  const differentlySignedToken = signSession({ id: 6 });
  process.env.SESSION_SECRET = "test-secret-value";
  assert.equal(await verifySessionEdge(differentlySignedToken), null);

  assert.equal(await verifySessionEdge(undefined), null);
  assert.equal(await verifySessionEdge("garbage"), null);
});
