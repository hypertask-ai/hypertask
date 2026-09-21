const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let entryId = 0;
const transfers = [];

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  delete require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function response() {
  const result = { statusCode: 200, body: undefined };
  return {
    result,
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
}

function loadRoute() {
  transfers.length = 0;

  stubModule("src/lib/prisma.ts", {
    default: {
      user: { findUnique: async () => null },
      project: { count: async () => 0 },
      team: { count: async () => 0 },
    },
  });
  stubModule("src/utils/controllers/users/resetUserAccount.ts", {
    resetUserAccount: async (...args) => {
      transfers.push(args);
      return { status: 200, json: { message: "Transferred" } };
    },
  });

  const jiti = require("jiti")(
    path.join(root, `tests/reset-user-auth-jiti-${++entryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const loaded = jiti(path.join(root, "src/pages/api/resetUser.ts"));

  return { handler: loaded.default ?? loaded, transfers };
}

async function request(handler, headers = {}) {
  const res = response();
  await handler(
    {
      method: "POST",
      headers,
      body: { userToResetId: 41, newOwnerId: 42 },
    },
    res,
  );
  return res.result;
}

test("resetUser rejects requests without the admin credential before transferring ownership", async () => {
  const previousPassword = process.env.ADMIN_USER_RESET_PW;
  process.env.ADMIN_USER_RESET_PW = "test-only-admin-password";

  try {
    const { handler, transfers } = loadRoute();

    assert.deepEqual(await request(handler), {
      statusCode: 401,
      body: { message: "Unauthorized" },
    });
    assert.deepEqual(
      await request(handler, { "x-admin-password": "wrong-password" }),
      { statusCode: 401, body: { message: "Unauthorized" } },
    );
    assert.equal(transfers.length, 0);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.ADMIN_USER_RESET_PW;
    } else {
      process.env.ADMIN_USER_RESET_PW = previousPassword;
    }
  }
});

test("resetUser fails closed when the admin credential is not configured", async () => {
  const previousPassword = process.env.ADMIN_USER_RESET_PW;
  delete process.env.ADMIN_USER_RESET_PW;

  try {
    const { handler, transfers } = loadRoute();

    assert.deepEqual(
      await request(handler, { "x-admin-password": "any-password" }),
      { statusCode: 401, body: { message: "Unauthorized" } },
    );
    assert.equal(transfers.length, 0);
  } finally {
    if (previousPassword !== undefined) {
      process.env.ADMIN_USER_RESET_PW = previousPassword;
    }
  }
});

test("resetUser permits the configured admin credential", async () => {
  const previousPassword = process.env.ADMIN_USER_RESET_PW;
  process.env.ADMIN_USER_RESET_PW = "test-only-admin-password";

  try {
    const { handler, transfers } = loadRoute();

    assert.deepEqual(
      await request(handler, {
        "x-admin-password": "test-only-admin-password",
      }),
      { statusCode: 200, body: { message: "Transferred" } },
    );
    assert.deepEqual(transfers, [[41, 42]]);
  } finally {
    if (previousPassword === undefined) {
      delete process.env.ADMIN_USER_RESET_PW;
    } else {
      process.env.ADMIN_USER_RESET_PW = previousPassword;
    }
  }
});
