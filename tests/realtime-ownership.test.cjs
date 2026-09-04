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

function request(channel, { method = "POST", socketId = "123.456" } = {}) {
  return {
    method,
    body: { socket_id: socketId, channel_name: channel },
    cookies: { nookies_user: "signed-cookie" },
    headers: { cookie: "ht_session=signed-session" },
  };
}

function loadPusherAuth({
  user = { id: 6 },
  allowedProjects = [15],
  tasks = { 42: { projectId: 15 } },
  realtimeConfigured = true,
  sessionError = null,
} = {}) {
  const calls = {
    authorize: [],
    projectAccess: [],
    taskLookup: [],
  };
  const server = realtimeConfigured
    ? {
        authorizeChannel(socketId, channel) {
          calls.authorize.push([socketId, channel]);
          return { auth: `signed:${channel}` };
        },
      }
    : null;
  const handler = loadTypeScript("src/pages/api/pusher/auth.ts", {
    "@/utils/edgeHelpers": {
      isValidUser: () => ({ user, isValid: Boolean(user) }),
    },
    "@/lib/mcp/tasks/services": {
      validateProjectAccess: async (projectId, userId, token) => {
        calls.projectAccess.push([projectId, userId, token]);
        return allowedProjects.includes(projectId)
          ? { error: null }
          : { error: "No project access" };
      },
    },
    "@/lib/realtime/server": {
      getRealtimeServer: () => server,
    },
    "@/lib/realtime/shared": {
      featureFlagsChannel: () => "private-feature-flags",
    },
    "@/lib/auth/getSessionUser": {
      getSessionUser: async () => {
        if (sessionError) throw sessionError;
        return user ? { userId: Number(user.id) } : null;
      },
    },
    "@/lib/prisma": {
      __esModule: true,
      default: {
        task: {
          findUnique: async (query) => {
            calls.taskLookup.push(query);
            return tasks[query.where.id] ?? null;
          },
        },
      },
    },
  });
  return { calls, handler };
}

async function invoke(handler, req) {
  const { response, result } = responseRecorder();
  await handler(req, response);
  return result;
}

test("a user can subscribe to only their own notification channel", async () => {
  const own = loadPusherAuth();
  const ownResult = await invoke(own.handler, request("private-user-6"));

  assert.equal(ownResult.status, 200);
  assert.deepEqual(ownResult.body, { auth: "signed:private-user-6" });
  assert.deepEqual(own.calls.authorize, [
    ["123.456", "private-user-6"],
  ]);

  for (const channel of [
    "private-user-7",
    "private-user-not-a-number",
    "public-user-6",
  ]) {
    const denied = loadPusherAuth();
    const deniedResult = await invoke(denied.handler, request(channel));

    assert.equal(deniedResult.status, 403, channel);
    assert.deepEqual(denied.calls.authorize, [], channel);
  }
});

test("feature flag events require a signed session", async () => {
  const signed = loadPusherAuth();
  const signedResult = await invoke(signed.handler, request("private-feature-flags"));
  assert.equal(signedResult.status, 200);

  const anonymous = loadPusherAuth({ user: null });
  const anonymousResult = await invoke(
    anonymous.handler,
    request("private-feature-flags"),
  );
  assert.equal(anonymousResult.status, 403);
  assert.deepEqual(anonymous.calls.authorize, []);
});

test("feature flag auth failures return a structured error", async (t) => {
  t.mock.method(console, "error", () => {});
  const failed = loadPusherAuth({ sessionError: new Error("auth unavailable") });
  const result = await invoke(failed.handler, request("private-feature-flags"));
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: "Unable to authorize realtime channel" });
  assert.deepEqual(failed.calls.authorize, []);
});

test("board channels require access for the signed-in user", async () => {
  for (const channel of ["private-project-15", "private-time-project-15"]) {
    const allowed = loadPusherAuth();
    const result = await invoke(allowed.handler, request(channel));

    assert.equal(result.status, 200, channel);
    assert.deepEqual(allowed.calls.projectAccess, [[15, 6, null]], channel);
    assert.deepEqual(allowed.calls.authorize, [["123.456", channel]], channel);
  }

  const denied = loadPusherAuth();
  const result = await invoke(
    denied.handler,
    request("private-project-999"),
  );

  assert.equal(result.status, 403);
  assert.deepEqual(denied.calls.projectAccess, [[999, 6, null]]);
  assert.deepEqual(denied.calls.authorize, []);
});

test("task channels inherit access from the task's board", async () => {
  for (const channel of ["private-task-42", "private-time-task-42"]) {
    const allowed = loadPusherAuth();
    const result = await invoke(allowed.handler, request(channel));

    assert.equal(result.status, 200, channel);
    assert.deepEqual(allowed.calls.taskLookup, [
      { where: { id: 42 }, select: { projectId: true } },
    ]);
    assert.deepEqual(allowed.calls.projectAccess, [[15, 6, null]]);
    assert.deepEqual(allowed.calls.authorize, [["123.456", channel]]);
  }

  const inaccessible = loadPusherAuth({
    tasks: { 42: { projectId: 999 } },
  });
  const inaccessibleResult = await invoke(
    inaccessible.handler,
    request("private-task-42"),
  );
  assert.equal(inaccessibleResult.status, 403);
  assert.deepEqual(inaccessible.calls.projectAccess, [[999, 6, null]]);
  assert.deepEqual(inaccessible.calls.authorize, []);

  const missing = loadPusherAuth();
  const missingResult = await invoke(
    missing.handler,
    request("private-task-404"),
  );
  assert.equal(missingResult.status, 403);
  assert.deepEqual(missing.calls.projectAccess, []);
  assert.deepEqual(missing.calls.authorize, []);
});

test("invalid requests cannot reach the realtime signer", async () => {
  const wrongMethod = loadPusherAuth();
  const methodResult = await invoke(
    wrongMethod.handler,
    request("private-user-6", { method: "GET" }),
  );
  assert.equal(methodResult.status, 405);
  assert.deepEqual(wrongMethod.calls.authorize, []);

  const anonymous = loadPusherAuth({ user: null });
  const anonymousResult = await invoke(
    anonymous.handler,
    request("private-user-6"),
  );
  assert.equal(anonymousResult.status, 403);
  assert.deepEqual(anonymous.calls.authorize, []);

  const missingFields = loadPusherAuth();
  const missingResult = await invoke(missingFields.handler, {
    method: "POST",
    body: {},
    cookies: { nookies_user: "signed-cookie" },
  });
  assert.equal(missingResult.status, 400);
  assert.deepEqual(missingFields.calls.authorize, []);

  const unconfigured = loadPusherAuth({ realtimeConfigured: false });
  const unconfiguredResult = await invoke(
    unconfigured.handler,
    request("private-user-6"),
  );
  assert.equal(unconfiguredResult.status, 503);
  assert.deepEqual(unconfigured.calls.authorize, []);
});

function loadRealtimeServer({ configured = true, triggerError = null } = {}) {
  const calls = { constructed: [], trigger: [], waitUntil: [] };
  class FakePusher {
    constructor(options) {
      calls.constructed.push(options);
    }

    trigger(...args) {
      calls.trigger.push(args);
      return triggerError
        ? Promise.reject(triggerError)
        : Promise.resolve({ delivered: true });
    }
  }
  const envNames = [
    "PUSHER_APP_ID",
    "PUSHER_KEY",
    "PUSHER_SECRET",
    "PUSHER_HOST",
    "PUSHER_PORT",
    "PUSHER_USE_TLS",
    "PUSHER_CLUSTER",
  ];
  const previous = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );

  if (configured) {
    process.env.PUSHER_APP_ID = "test-app";
    process.env.PUSHER_KEY = "test-key";
    process.env.PUSHER_SECRET = "test-secret";
  } else {
    delete process.env.PUSHER_APP_ID;
    delete process.env.PUSHER_KEY;
    delete process.env.PUSHER_SECRET;
  }

  try {
    const realtime = loadTypeScript("src/lib/realtime/server.ts", {
      pusher: FakePusher,
      "@vercel/functions": {
        waitUntil: (promise) => calls.waitUntil.push(promise),
      },
      "./shared": {
        BOARD_EVENT: "board:changed",
        COMMENT_EVENT: "comment:changed",
        INBOX_EVENT: "inbox:changed",
        TASK_EVENT: "task:changed",
        TIME_EVENT: "time:changed",
        FEATURE_FLAGS_EVENT: "feature-flags:changed",
        boardChannel: (id) => `private-project-${id}`,
        featureFlagsChannel: () => "private-feature-flags",
        taskChannel: (id) => `private-task-${id}`,
        timeBoardChannel: (id) => `private-time-project-${id}`,
        timeTaskChannel: (id) => `private-time-task-${id}`,
        userChannel: (id) => `private-user-${id}`,
      },
    });
    return { calls, realtime };
  } finally {
    for (const name of envNames) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("notification broadcasts target one user's channel and exclude only the acting socket", async () => {
  const { calls, realtime } = loadRealtimeServer();

  await realtime.broadcastInboxChange(
    6,
    { originUserId: 9 },
    "123.456",
  );

  assert.deepEqual(calls.trigger, [
    [
      "private-user-6",
      "inbox:changed",
      { originUserId: 9 },
      { socket_id: "123.456" },
    ],
  ]);
  assert.equal(calls.waitUntil.length, 1);
});

test("feature flag broadcasts carry no privileged payload", async () => {
  const { calls, realtime } = loadRealtimeServer();
  await realtime.broadcastFeatureFlagsChange();
  assert.deepEqual(calls.trigger, [
    ["private-feature-flags", "feature-flags:changed", {}, undefined],
  ]);
});

test("missing recipients and disabled realtime have no broadcast side effects", async () => {
  const configured = loadRealtimeServer();
  await configured.realtime.broadcastInboxChange(null, { originUserId: 6 });
  assert.deepEqual(configured.calls.trigger, []);
  assert.deepEqual(configured.calls.waitUntil, []);

  const disabled = loadRealtimeServer({ configured: false });
  await disabled.realtime.broadcastInboxChange(6, { originUserId: 6 });
  assert.deepEqual(disabled.calls.constructed, []);
  assert.deepEqual(disabled.calls.trigger, []);
  assert.deepEqual(disabled.calls.waitUntil, []);
});

test("failed realtime deliveries are absorbed after waitUntil captures them", async () => {
  const triggerError = new Error("delivery failed");
  const { calls, realtime } = loadRealtimeServer({ triggerError });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    await assert.doesNotReject(() =>
      realtime.broadcastInboxChange(6, { originUserId: 9 }),
    );
    assert.equal(calls.waitUntil.length, 1);
    await assert.doesNotReject(calls.waitUntil[0]);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(warnings, [
    [
      "[realtime] broadcast failed",
      "private-user-6",
      "inbox:changed",
      triggerError,
    ],
  ]);
});

test("socket exclusion accepts only Pusher socket identifiers", () => {
  const { realtime } = loadRealtimeServer({ configured: false });

  assert.equal(realtime.socketIdFromHeader("123.456"), "123.456");
  assert.equal(realtime.socketIdFromHeader(["789.012", "ignored"]), "789.012");
  assert.equal(realtime.socketIdFromHeader("private-user-6"), undefined);
  assert.equal(realtime.socketIdFromHeader(undefined), undefined);
});
