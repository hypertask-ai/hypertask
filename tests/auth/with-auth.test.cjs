const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const jiti = require("jiti")(path.join(root, "tests/with-auth-jiti.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

process.env.BETTER_AUTH_ENABLED = "0";
process.env.SESSION_SECRET = "with-auth-test-secret-that-is-long-enough";
const { getAuthSession, withAuth } = jiti(
  path.join(root, "src/lib/api/withAuth.ts"),
);
const { signSession } = jiti(path.join(root, "src/lib/auth/session.ts"));

test("App Router withAuth rejects before calling the handler", async () => {
  let called = false;
  const handler = withAuth(async () => {
    called = true;
    return new Response(null, { status: 204 });
  });

  const response = await handler(new Request("https://example.test/api/private"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.equal(called, false);
});

test("App Router withAuth exposes the verified session to the handler", async () => {
  const token = signSession({ id: 42, email: "agent@example.test" });
  const handler = withAuth(async (request) => {
    const session = await getAuthSession(request.headers);
    return Response.json({ userId: session?.userId });
  });

  const response = await handler(
    new Request("https://example.test/api/private", {
      headers: { cookie: `ht_session=${token}` },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { userId: 42 });
});

test("Pages Router withAuth rejects before calling the handler", async () => {
  let called = false;
  let status;
  let body;
  const response = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  const handler = withAuth(async () => {
    called = true;
  });

  await handler({}, response);
  assert.equal(status, 401);
  assert.deepEqual(body, { error: "Unauthorized" });
  assert.equal(called, false);
});
