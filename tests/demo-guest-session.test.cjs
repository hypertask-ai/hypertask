const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const calls = {
  provisionGuest: [],
  provisionGuestBoard: [],
};
let currentSession = null;
let currentUser = null;
let currentProject = null;
let provisionError = null;
let regenerationError = null;

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

class NextRequest extends Request {
  constructor(url, init) {
    super(url, init);
    this.nextUrl = new URL(url);
    this.cookies = {
      get: (name) => {
        const cookie = this.headers
          .get("cookie")
          ?.split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${name}=`));
        return cookie ? { value: cookie.slice(name.length + 1) } : undefined;
      },
    };
  }
}

class NextResponse {
  static json(body, init) {
    const response = new Response(JSON.stringify(body), {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    response.cookies = {
      set: (name, value) => {
        response.headers.append(
          "set-cookie",
          `${name}=${encodeURIComponent(value)}; Path=/`,
        );
      },
    };
    return response;
  }
}

const nextServerPath = require.resolve("next/server");
require.cache[nextServerPath] = {
  id: nextServerPath,
  filename: nextServerPath,
  loaded: true,
  exports: { NextRequest, NextResponse },
};

stubModule("src/lib/auth/betterAuth.ts", {
  auth: { handler: async () => new Response(null, { status: 204 }) },
});
stubModule("src/lib/auth/session.ts", {
  SESSION_COOKIE: "ht_session",
  sessionCookieOptions: (maxAge) => ({
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge,
    path: "/",
  }),
  signSession: () => "signed-guest-session",
  verifySession: () => currentSession,
});
stubModule("src/lib/demo/guest.ts", {
  GUEST_SESSION_TTL_SECONDS: 86_400,
  isGuestUser: (user) => user?.uid?.startsWith("guest_") ?? false,
});
// The route resolves identity through getSessionUser so a Better Auth session
// outliving ht_session still counts as signed in; mirror that in the stub.
stubModule("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () =>
    currentSession ? { userId: currentSession.id, source: "legacy" } : null,
});

class DemoBoardGenerationUnavailableError extends Error {}

stubModule("src/lib/demo/generateDemoBoard.ts", {
  DemoBoardGenerationUnavailableError,
});
stubModule("src/lib/demo/provisionGuest.ts", {
  provisionGuest: async (purpose) => {
    calls.provisionGuest.push(purpose);
    if (provisionError) throw provisionError;
    return {
      userId: 900,
      projectId: 901,
      boardUrl: "/project?id=901",
      uniqueIdentifier: "DEMO",
      userRecord: {
        id: 900,
        uid: "guest_new",
        email: "guest+new@demo.hypertask.ai",
      },
    };
  },
  provisionGuestBoard: async (...args) => {
    calls.provisionGuestBoard.push(args);
    if (regenerationError) throw regenerationError;
    return {
      projectId: 902,
      boardUrl: "/project?id=902",
      uniqueIdentifier: "DEMO2",
    };
  },
});
stubModule("src/lib/prisma.ts", {
  default: {
    user: { findUnique: async () => currentUser },
    project: { findFirst: async () => currentProject },
  },
});

const jiti = require("jiti")(
  path.join(root, "tests/demo-guest-session-jiti.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  },
);
const { POST } = jiti(path.join(root, "src/app/api/demo/guest/route.ts"));

function request(sessionCookie, body = "{}") {
  return new NextRequest("https://app.hypertask.ai/api/demo/guest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionCookie ? { cookie: `ht_session=${sessionCookie}` } : {}),
    },
    body,
  });
}

const originalDemoKey = process.env.DEMO_AI_GATEWAY_API_KEY;
test.after(() => {
  if (originalDemoKey === undefined) delete process.env.DEMO_AI_GATEWAY_API_KEY;
  else process.env.DEMO_AI_GATEWAY_API_KEY = originalDemoKey;
});

test.beforeEach(() => {
  currentSession = null;
  currentUser = null;
  currentProject = null;
  provisionError = null;
  regenerationError = null;
  process.env.DEMO_AI_GATEWAY_API_KEY = "dedicated-demo-test-key";
  calls.provisionGuest.length = 0;
  calls.provisionGuestBoard.length = 0;
});

test("a guest session returns its existing demo board", async () => {
  currentSession = { id: 900, email: "guest+old@demo.hypertask.ai" };
  currentUser = {
    id: 900,
    uid: "guest_old",
    email: "guest+old@demo.hypertask.ai",
    accountId: "account-900",
  };
  currentProject = {
    id: 901,
    googleAccountId: "account-900",
    teamId: "team-900",
    uniqueIdentifier: "DEMO",
  };

  const response = await POST(request("guest-session"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: 901,
    boardUrl: "/project?id=901",
    uniqueIdentifier: "DEMO",
  });
  assert.deepEqual(calls.provisionGuest, []);
  assert.deepEqual(calls.provisionGuestBoard, []);
});

test("a real-user session returns the app root without provisioning or cookies", async () => {
  currentSession = { id: 6, email: "owner@example.test" };
  currentUser = {
    id: 6,
    uid: "firebase-owner",
    email: "owner@example.test",
  };

  const response = await POST(request("real-session"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: null,
    boardUrl: "/",
    uniqueIdentifier: null,
  });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(calls.provisionGuest, []);
  assert.deepEqual(calls.provisionGuestBoard, []);
});

test("a request without a session provisions a guest", async () => {
  const response = await POST(request());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: 901,
    boardUrl: "/project?id=901",
    uniqueIdentifier: "DEMO",
  });
  assert.deepEqual(calls.provisionGuest, [""]);
  assert.deepEqual(calls.provisionGuestBoard, []);
  assert.match(response.headers.get("set-cookie") ?? "", /ht_session=/);
});

function returningGuest(userId) {
  currentSession = { id: userId, email: "guest+old@demo.hypertask.ai" };
  currentUser = {
    id: userId,
    uid: "guest_old",
    email: currentSession.email,
    accountId: "account-900",
  };
  currentProject = {
    id: 901,
    googleAccountId: "account-900",
    teamId: "team-900",
    uniqueIdentifier: "DEMO",
  };
}

test("a returning guest's purpose regenerates a board using the existing owner", async () => {
  returningGuest(910);
  const response = await POST(request("guest-session", '{"purpose":" Build a SaaS MVP "}'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: 902,
    boardUrl: "/project?id=902",
    uniqueIdentifier: "DEMO2",
  });
  assert.deepEqual(calls.provisionGuestBoard, [["Build a SaaS MVP", {
    userId: 910,
    googleAccountId: "account-900",
    teamId: "team-900",
  }]]);
  assert.deepEqual(calls.provisionGuest, []);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("a cookie-free purpose provisions a new guest", async () => {
  const response = await POST(request(undefined, '{"purpose":"Build a SaaS MVP"}'));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.provisionGuest, ["Build a SaaS MVP"]);
  assert.deepEqual(calls.provisionGuestBoard, []);
  assert.match(response.headers.get("set-cookie") ?? "", /ht_session=/);
});

for (const [body, error] of [
  ["{", "request body must be valid JSON"],
  ["null", "request body must be a JSON object"],
  ["[]", "request body must be a JSON object"],
  ['{"purpose":{}}', "purpose must be a string"],
  ['{"purpose":123}', "purpose must be a string"],
  ['{"purpose":null}', "purpose must be a string"],
  ['{"purpose":" a "}', "purpose too short"],
]) {
  test(`invalid client input returns a clear 400 for fresh and returning guests: ${body}`, async () => {
    for (const sessionCookie of [undefined, "guest-session"]) {
      if (sessionCookie) returningGuest(920);
      const response = await POST(request(sessionCookie, body));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error });
    }
    assert.deepEqual(calls.provisionGuest, []);
    assert.deepEqual(calls.provisionGuestBoard, []);
  });
}

for (const existingGuest of [false, true]) {
  test(`${existingGuest ? "regeneration" : "provisioning"} logs the actual exception message without leaking it to the client`, async (t) => {
    const error = new Error("No object generated: could not parse the response.");
    if (existingGuest) {
      returningGuest(930);
      regenerationError = error;
    } else {
      provisionError = error;
    }
    const logs = [];
    t.mock.method(console, "error", (...args) => logs.push(args));
    const response = await POST(request(existingGuest ? "guest-session" : undefined, '{"purpose":"Build a SaaS MVP"}'));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: existingGuest ? "guest board regeneration failed" : "guest provisioning failed",
    });
    assert.deepEqual(logs, [[
      existingGuest ? "guest demo regeneration failed" : "guest demo provisioning failed",
      error.message,
      error,
    ]]);
  });
}

test("generation without its dedicated key returns 503 before provisioning", async () => {
  delete process.env.DEMO_AI_GATEWAY_API_KEY;
  returningGuest(940);
  const response = await POST(request("guest-session", '{"purpose":"Build a SaaS MVP"}'));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "demo generation unavailable" });
  assert.deepEqual(calls.provisionGuest, []);
  assert.deepEqual(calls.provisionGuestBoard, []);
});
