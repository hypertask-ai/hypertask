const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScript(relativePath, stubs = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };

  new Function(
    "module",
    "exports",
    "require",
    "__filename",
    "__dirname",
    javascript,
  )(
    loadedModule,
    loadedModule.exports,
    (request) => stubs[request] ?? require(request),
    filename,
    path.dirname(filename),
  );

  return loadedModule.exports;
}

function responseRecorder() {
  const result = { status: null, body: null, ended: false, headers: {} };
  const response = {
    status(status) {
      result.status = status;
      return response;
    },
    json(body) {
      result.body = body;
      return response;
    },
    end() {
      result.ended = true;
      return response;
    },
    setHeader(name, value) {
      result.headers[name] = value;
      return response;
    },
  };
  return { response, result };
}

function loadAuth(verifyIdToken) {
  return loadTypeScript("src/lib/admin/requireAnnouncementAdmin.ts", {
    "@/lib/firebase-admin": {
      getAuth: () => ({ verifyIdToken }),
    },
  });
}

async function authorize(requireAnnouncementAdmin, authorization) {
  const { response, result } = responseRecorder();
  const allowed = await requireAnnouncementAdmin(
    { headers: authorization ? { authorization } : {} },
    response,
  );
  return { allowed, result };
}

test("announcement admin auth rejects missing and invalid Firebase credentials", async () => {
  const verified = [];
  const { requireAnnouncementAdmin } = loadAuth(async (token, checkRevoked) => {
    verified.push([token, checkRevoked]);
    throw new Error("invalid token");
  });

  assert.deepEqual(await authorize(requireAnnouncementAdmin), {
    allowed: false,
    result: {
      status: 401,
      body: { error: "Unauthorized" },
      ended: false,
      headers: {},
    },
  });
  assert.deepEqual(
    await authorize(requireAnnouncementAdmin, "Bearer invalid-firebase-token"),
    {
      allowed: false,
      result: {
        status: 401,
        body: { error: "Unauthorized" },
        ended: false,
        headers: {},
      },
    },
  );
  assert.deepEqual(verified, [["invalid-firebase-token", true]]);
});

test("announcement admin auth requires a strict Boolean admin custom claim", async () => {
  const { requireAnnouncementAdmin } = loadAuth(async () => ({
    uid: "ordinary-user",
    admin: "true",
  }));

  assert.deepEqual(
    await authorize(requireAnnouncementAdmin, "Bearer signed-user-token"),
    {
      allowed: false,
      result: {
        status: 403,
        body: { error: "Forbidden" },
        ended: false,
        headers: {},
      },
    },
  );
});

test("announcement admin auth accepts a non-revoked Firebase admin token", async () => {
  const verified = [];
  const { requireAnnouncementAdmin } = loadAuth(async (token, checkRevoked) => {
    verified.push([token, checkRevoked]);
    return { uid: "admin-user", admin: true };
  });

  assert.deepEqual(
    await authorize(requireAnnouncementAdmin, "Bearer signed-admin-token"),
    {
      allowed: true,
      result: { status: null, body: null, ended: false, headers: {} },
    },
  );
  assert.deepEqual(verified, [["signed-admin-token", true]]);
});

test("announcement admin auth preserves the configured owner CLI credential", async () => {
  const previousSecret = process.env.ANNOUNCEMENTS_SECRET_KEY;
  process.env.ANNOUNCEMENTS_SECRET_KEY = "test-only-owner-secret";
  let firebaseCalls = 0;

  try {
    const { requireAnnouncementAdmin } = loadAuth(async () => {
      firebaseCalls += 1;
      throw new Error("owner secret must not reach Firebase");
    });

    assert.deepEqual(
      await authorize(
        requireAnnouncementAdmin,
        "Bearer test-only-owner-secret",
      ),
      {
        allowed: true,
        result: { status: null, body: null, ended: false, headers: {} },
      },
    );
    assert.equal(firebaseCalls, 0);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.ANNOUNCEMENTS_SECRET_KEY;
    } else {
      process.env.ANNOUNCEMENTS_SECRET_KEY = previousSecret;
    }
  }
});

function loadPostRoute(authorizeAdmin) {
  const writes = [];
  const corsOptions = [];
  const handler = loadTypeScript("src/pages/api/admin/postAnnouncement.ts", {
    "@/lib/admin/requireAnnouncementAdmin": {
      requireAnnouncementAdmin: authorizeAdmin,
    },
    "nextjs-cors": {
      __esModule: true,
      default: async (_req, _res, options) => corsOptions.push(options),
    },
    "@/lib/prisma": {
      __esModule: true,
      default: {
        announcments: {
          create: async (write) => {
            writes.push(["create", write]);
            return { id: 9, isWelcome: false };
          },
        },
        user: {
          findMany: async () => [],
        },
        userAnnouncement: {
          createMany: async (write) => {
            writes.push(["recipients", write]);
            return { count: write.data.length };
          },
        },
      },
    },
  }).default;
  return { handler, writes, corsOptions };
}

async function callPost(handler, method = "POST") {
  const { response, result } = responseRecorder();
  await handler(
    {
      method,
      headers: {},
      query: {},
      body: { jsonBody: { title: "Security test" } },
    },
    response,
  );
  return result;
}

test("announcement creation checks admin authorization before database writes", async () => {
  const authCalls = [];
  const denied = loadPostRoute(async () => {
    authCalls.push("denied");
    return false;
  });

  await callPost(denied.handler);
  assert.deepEqual(authCalls, ["denied"]);
  assert.deepEqual(denied.writes, []);

  const allowed = loadPostRoute(async () => true);
  assert.equal((await callPost(allowed.handler)).status, 200);
  assert.deepEqual(allowed.writes, [
    [
      "create",
      {
        data: {
          body: { title: "Security test" },
          isWelcome: false,
        },
      },
    ],
  ]);
});

test("announcement creation rejects unsupported methods before authorization or writes", async () => {
  let authCalls = 0;
  const { handler, writes } = loadPostRoute(async () => {
    authCalls += 1;
    return true;
  });

  const result = await callPost(handler, "GET");

  assert.equal(result.status, 405);
  assert.deepEqual(result.headers, { Allow: "POST" });
  assert.equal(authCalls, 0);
  assert.deepEqual(writes, []);
});

test("announcement creation permits CORS preflight without authorization or writes", async () => {
  let authCalls = 0;
  const { handler, writes, corsOptions } = loadPostRoute(async () => {
    authCalls += 1;
    return true;
  });

  const result = await callPost(handler, "OPTIONS");

  assert.equal(result.status, 200);
  assert.equal(result.ended, true);
  assert.deepEqual(corsOptions.map(({ methods, preflightContinue }) => ({
    methods,
    preflightContinue,
  })), [{ methods: ["POST"], preflightContinue: true }]);
  assert.equal(authCalls, 0);
  assert.deepEqual(writes, []);
});

function loadUpdateRoute(authorizeAdmin) {
  const writes = [];
  const corsOptions = [];
  const handler = loadTypeScript(
    "src/pages/api/admin/announcements/updateAnnouncement.ts",
    {
      "@/lib/admin/requireAnnouncementAdmin": {
        requireAnnouncementAdmin: authorizeAdmin,
      },
      "nextjs-cors": {
        __esModule: true,
        default: async (_req, _res, options) => corsOptions.push(options),
      },
      "@/lib/prisma": {
        __esModule: true,
        default: {
          announcments: {
            update: async (write) => {
              writes.push(["update", write]);
              return { id: write.where.id };
            },
            deleteMany: async (write) => {
              writes.push(["delete-announcement", write]);
              return { count: 1 };
            },
          },
          userAnnouncement: {
            updateMany: async (write) => {
              writes.push(["reset-read-state", write]);
              return { count: 2 };
            },
            deleteMany: async (write) => {
              writes.push(["delete-recipients", write]);
              return { count: 2 };
            },
          },
        },
      },
    },
  ).default;
  return { handler, writes, corsOptions };
}

async function callUpdate(handler, method) {
  const { response, result } = responseRecorder();
  await handler(
    {
      method,
      headers: {},
      query: { announcementId: "17" },
      body: {
        announcementId: 17,
        jsonBody: { title: "Updated security test" },
      },
    },
    response,
  );
  return result;
}

test("announcement update and deletion authorize before every database mutation", async () => {
  const denied = loadUpdateRoute(async () => false);
  await callUpdate(denied.handler, "POST");
  await callUpdate(denied.handler, "DELETE");
  assert.deepEqual(denied.writes, []);

  const update = loadUpdateRoute(async () => true);
  assert.equal((await callUpdate(update.handler, "POST")).status, 200);
  assert.deepEqual(update.writes, [
    [
      "update",
      {
        where: { id: 17 },
        data: { body: { title: "Updated security test" } },
      },
    ],
    [
      "reset-read-state",
      { where: { announcementId: 17 }, data: { readAt: null } },
    ],
  ]);

  const deletion = loadUpdateRoute(async () => true);
  assert.equal((await callUpdate(deletion.handler, "DELETE")).status, 200);
  assert.deepEqual(deletion.writes, [
    ["delete-recipients", { where: { announcementId: 17 } }],
    ["delete-announcement", { where: { id: 17 } }],
  ]);
});

test("announcement update rejects unsupported methods before authorization or writes", async () => {
  let authCalls = 0;
  const { handler, writes } = loadUpdateRoute(async () => {
    authCalls += 1;
    return true;
  });

  const result = await callUpdate(handler, "PUT");

  assert.equal(result.status, 405);
  assert.deepEqual(result.headers, { Allow: "POST, DELETE" });
  assert.equal(authCalls, 0);
  assert.deepEqual(writes, []);
});

test("announcement update permits CORS preflight without authorization or writes", async () => {
  let authCalls = 0;
  const { handler, writes, corsOptions } = loadUpdateRoute(async () => {
    authCalls += 1;
    return true;
  });

  const result = await callUpdate(handler, "OPTIONS");

  assert.equal(result.status, 200);
  assert.equal(result.ended, true);
  assert.deepEqual(corsOptions.map(({ methods, preflightContinue }) => ({
    methods,
    preflightContinue,
  })), [{ methods: ["POST", "DELETE"], preflightContinue: true }]);
  assert.equal(authCalls, 0);
  assert.deepEqual(writes, []);
});
