const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function modulePath(relativePath) {
  return path.join(root, relativePath);
}

function stubModule(relativePath, exports) {
  const filename = modulePath(relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

process.env.SESSION_SECRET = "get-first-project-test-secret";

const controllerCalls = [];
stubModule("src/utils/controllers/projects/getFirst.ts", {
  default: async (userId) => {
    controllerCalls.push(userId);
    return { status: 200, json: { id: 42 } };
  },
});

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const { signSession, SESSION_COOKIE } = jiti(
  modulePath("src/lib/auth/session.ts"),
);
const loadedRoute = jiti(modulePath("src/pages/api/projects/getFirst.ts"));
const handler =
  typeof loadedRoute === "function" ? loadedRoute : loadedRoute.default;

test.beforeEach(() => {
  controllerCalls.length = 0;
});

test("getFirst rejects requests without a signed session", async () => {
  const response = responseRecorder();

  await handler(
    { method: "GET", cookies: { nookies_user: JSON.stringify({ id: 999 }) } },
    response,
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, {
    error: "Unauthorized",
    code: "SESSION_REQUIRED",
  });
  assert.deepEqual(controllerCalls, []);
});

test("getFirst uses the signed session when the client user cookie has no id", async () => {
  const response = responseRecorder();
  const token = signSession({ id: 6 });

  await handler(
    {
      method: "GET",
      cookies: {
        [SESSION_COOKIE]: token,
        nookies_user: JSON.stringify({}),
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { id: 42 });
  assert.deepEqual(controllerCalls, [6]);
});

test("getFirst ignores a spoofed client user id", async () => {
  const response = responseRecorder();
  const token = signSession({ id: 6 });

  await handler(
    {
      method: "GET",
      cookies: {
        [SESSION_COOKIE]: token,
        nookies_user: JSON.stringify({ id: 999 }),
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(controllerCalls, [6]);
});
