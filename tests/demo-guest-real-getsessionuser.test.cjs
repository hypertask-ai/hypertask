// End-to-end proof for HTPR-5453: /api/demo/guest must never provision a
// real signed-in user as a guest, with the getSessionUser fast path ON. This
// is the exact shape of the Aug 21 incident: the demo route decides "already
// signed in?" purely from getSessionUser's non-null/null answer (HTPR-5460),
// so this test runs the REAL getSessionUser (not stubbed, unlike
// demo-guest-session.test.cjs) against a real signed ht_session cookie.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let currentUser = null;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  delete require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
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

// betterAuth.ts is stubbed (no real adapter/DB) — irrelevant here since the
// fast path never reaches it when the legacy cookie is valid.
stubModule("src/lib/auth/betterAuth.ts", {
  auth: {
    handler: async () => new Response(null, { status: 204 }),
    api: {
      getSession: async () => {
        throw new Error("Better Auth must not be called: legacy cookie is valid");
      },
    },
  },
});
stubModule("src/lib/demo/guest.ts", {
  GUEST_SESSION_TTL_SECONDS: 86_400,
  isGuestUser: (user) => user?.uid?.startsWith("guest_") ?? false,
});
class DemoBoardGenerationUnavailableError extends Error {}
stubModule("src/lib/demo/generateDemoBoard.ts", {
  DemoBoardGenerationUnavailableError,
});
const provisionCalls = [];
stubModule("src/lib/demo/provisionGuest.ts", {
  provisionGuest: async (purpose) => {
    provisionCalls.push(purpose);
    throw new Error("a real signed-in user must never be provisioned as a guest");
  },
  provisionGuestBoard: async () => {
    throw new Error("a real signed-in user must never be provisioned a guest board");
  },
});
stubModule("src/lib/prisma.ts", {
  default: {
    user: { findUnique: async () => currentUser },
    project: { findFirst: async () => null },
  },
});

const originalSessionSecret = process.env.SESSION_SECRET;
const originalBetterAuthEnabled = process.env.BETTER_AUTH_ENABLED;
const originalFastPath = process.env.AUTH_LEGACY_FAST_PATH;
process.env.SESSION_SECRET = "test-secret-value-that-is-long-enough";
process.env.BETTER_AUTH_ENABLED = "1";
process.env.AUTH_LEGACY_FAST_PATH = "1";
test.after(() => {
  for (const [key, value] of Object.entries({
    SESSION_SECRET: originalSessionSecret,
    BETTER_AUTH_ENABLED: originalBetterAuthEnabled,
    AUTH_LEGACY_FAST_PATH: originalFastPath,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// getSessionUser.ts, session.ts, and better-auth/cookies load for real — only
// betterAuth.ts (the DB-backed adapter) is stubbed above.
const jiti = require("jiti")(
  path.join(root, "tests/demo-guest-real-getsessionuser-jiti.cjs"),
  { interopDefault: true, alias: { "@": path.join(root, "src") }, cache: false },
);
const { signSession } = jiti(path.join(root, "src/lib/auth/session.ts"));
const { POST } = jiti(path.join(root, "src/app/api/demo/guest/route.ts"));

test("a real signed-in user with a valid legacy cookie is never provisioned as a guest, fast path on", async () => {
  currentUser = { id: 6, uid: "firebase-owner", email: "owner@example.test" };
  const token = signSession({ id: 6 });

  const response = await POST(
    new NextRequest("https://app.hypertask.ai/api/demo/guest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `ht_session=${token}`,
      },
      body: "{}",
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    projectId: null,
    boardUrl: "/",
    uniqueIdentifier: null,
  });
  assert.deepEqual(provisionCalls, []);
});
