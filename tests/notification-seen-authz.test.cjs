// HTPR-4465: these routes previously trusted req.body.userId. A signed-in
// attacker could mark another user's notifications read and silence their
// unread-aware digest. Exercise the handlers so equivalent insecure code fails
// even if the implementation is renamed or reformatted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScript(relativePath, stubs) {
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
  const localRequire = (request) => stubs[request] ?? require(request);

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
    localRequire,
    filename,
    path.dirname(filename),
  );
  return loadedModule.exports.default ?? loadedModule.exports;
}

function responseRecorder() {
  const result = { status: null, body: null };
  const response = {
    status(status) {
      result.status = status;
      return response;
    },
    json(body) {
      result.body = body;
      return response;
    },
  };
  return { response, result };
}

function request(body, method = "POST") {
  return { method, body, query: {}, headers: {} };
}

function loadGetByTaskRoute(session) {
  const controllerCalls = [];
  const handler = loadTypeScript("src/pages/api/notifications/getByTask.ts", {
    "@/lib/auth/getSessionUser": {
      getSessionUser: async () => session,
    },
    "@/utils/controllers/notifications/getByTask": {
      __esModule: true,
      default: async (...args) => {
        controllerCalls.push(args);
        return { status: 200, json: { count: 1 } };
      },
    },
  });
  return { handler, controllerCalls };
}

function loadCommentSeenRoute(session) {
  const controllerCalls = [];
  const commentWrites = [];
  const handler = loadTypeScript("src/pages/api/comments/updateSeen.ts", {
    "@/lib/auth/getSessionUser": {
      getSessionUser: async () => session,
    },
    "@/utils/controllers/notifications/getByTask": {
      __esModule: true,
      default: async (...args) => {
        controllerCalls.push(args);
        return { status: 200, json: { count: 1 } };
      },
    },
    "@/lib/prisma": {
      __esModule: true,
      default: {
        comment: {
          updateMany: async (write) => {
            commentWrites.push(write);
            return { count: 2 };
          },
        },
      },
    },
  });
  return { handler, controllerCalls, commentWrites };
}

test("notification route ignores a body userId and writes as the session user", async () => {
  const { handler, controllerCalls } = loadGetByTaskRoute({
    userId: 6,
    source: "better-auth",
  });
  const { response, result } = responseRecorder();

  await handler(request({ taskId: "42", userId: 999 }), response);

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { count: 1 });
  assert.deepEqual(controllerCalls, [[6, "42"]]);
});

test("notification route rejects anonymous and non-POST requests before writes", async () => {
  const anonymous = loadGetByTaskRoute(null);
  const anonymousResponse = responseRecorder();
  await anonymous.handler(
    request({ taskId: "42", userId: 999 }),
    anonymousResponse.response,
  );
  assert.equal(anonymousResponse.result.status, 401);
  assert.deepEqual(anonymous.controllerCalls, []);

  const signedIn = loadGetByTaskRoute({ userId: 6, source: "better-auth" });
  const methodResponse = responseRecorder();
  await signedIn.handler(request({}, "GET"), methodResponse.response);
  assert.equal(methodResponse.result.status, 405);
  assert.deepEqual(signedIn.controllerCalls, []);
});

test("comment seen route scopes notification and comment writes to the session user", async () => {
  const { handler, controllerCalls, commentWrites } = loadCommentSeenRoute({
    userId: 6,
    source: "legacy",
    needsBridge: true,
  });
  const { response, result } = responseRecorder();

  await handler(
    request({ commentIds: [10, 11], taskId: "42", userId: 999 }),
    response,
  );

  assert.equal(result.status, 200);
  assert.deepEqual(controllerCalls, [[6, "42"]]);
  assert.deepEqual(commentWrites, [
    {
      where: {
        id: { in: [10, 11] },
        NOT: { seen: { has: 6 } },
      },
      data: { seen: { push: 6 } },
    },
  ]);
});

test("comment seen route rejects anonymous requests without side effects", async () => {
  const { handler, controllerCalls, commentWrites } = loadCommentSeenRoute(null);
  const { response, result } = responseRecorder();

  await handler(
    request({ commentIds: [10], taskId: "42", userId: 999 }),
    response,
  );

  assert.equal(result.status, 401);
  assert.deepEqual(controllerCalls, []);
  assert.deepEqual(commentWrites, []);
});

test("notification controller persists only the supplied session identity and task", async () => {
  const writes = [];
  const controller = loadTypeScript(
    "src/utils/controllers/notifications/getByTask.ts",
    {
      "@/lib/prisma": {
        __esModule: true,
        default: {
          notification: {
            updateMany: async (write) => {
              writes.push(write);
              return { count: 3 };
            },
          },
        },
      },
    },
  );

  const result = await controller(6, "42");

  assert.deepEqual(result, { status: 200, json: { count: 3 } });
  assert.deepEqual(writes, [
    {
      data: { seen: true },
      where: { userId: 6, taskId: 42, status: "Normal" },
    },
  ]);
});
