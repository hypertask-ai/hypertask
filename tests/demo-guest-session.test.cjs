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

function request(sessionCookie) {
  return new NextRequest("https://app.hypertask.ai/api/demo/guest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionCookie ? { cookie: `ht_session=${sessionCookie}` } : {}),
    },
    body: "{}",
  });
}

test.beforeEach(() => {
  currentSession = null;
  currentUser = null;
  currentProject = null;
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
