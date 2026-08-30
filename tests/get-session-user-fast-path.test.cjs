const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

// getSessionUser.ts transpiled once; a mock `require` is injected per load so
// @/lib/auth/betterAuth's `auth.api.getSession` is fully controllable while
// better-auth/cookies and @/lib/auth/session stay real — verifySession and
// cookie parsing are genuinely exercised, not mocked (HTPR-5453).
const source = fs.readFileSync(
  path.join(root, "src/lib/auth/getSessionUser.ts"),
  "utf8",
);
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const originalSessionSecret = process.env.SESSION_SECRET;
process.env.SESSION_SECRET = "test-secret-value-that-is-long-enough";
test.after(() => {
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const realSessionModule = jiti(path.join(root, "src/lib/auth/session.ts"));
const realCookiesModule = require("better-auth/cookies");
const { signSession, SESSION_COOKIE } = realSessionModule;

function loadGetSessionUser(getSession) {
  const mod = { exports: {} };
  const mockRequire = (request) => {
    if (request === "better-auth/cookies") return realCookiesModule;
    if (request === "@/lib/auth/betterAuth") {
      return { auth: { api: { getSession } } };
    }
    if (request === "@/lib/auth/session") return realSessionModule;
    throw new Error(`Unexpected import in getSessionUser.ts: ${request}`);
  };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    mockRequire,
  );
  return mod.exports.getSessionUser;
}

const headersWithCookies = (pairs) =>
  new Headers({
    cookie: Object.entries(pairs)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}=${value}`)
      .join("; "),
  });

// These tests read process-wide env (SESSION_SECRET, BETTER_AUTH_ENABLED,
// AUTH_LEGACY_FAST_PATH). Serialize so concurrent test-runner scheduling
// can't leak env between cases.
let envQueue = Promise.resolve();
const withEnv = async (env, callback) => {
  const previous = envQueue;
  let release;
  envQueue = new Promise((resolve) => (release = resolve));
  await previous;

  const original = {};
  for (const key of Object.keys(env)) original[key] = process.env[key];
  process.env.SESSION_SECRET = "test-secret-value-that-is-long-enough";
  for (const [key, value] of Object.entries(env)) process.env[key] = value;

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    release();
  }
};

const neverCalled = async () => {
  throw new Error("Better Auth should not have been called");
};

// --- The 10-row precedence matrix -----------------------------------------

test("row 1: legacy absent, Better Auth valid -> Better Auth wins, unaffected by the flag", async () => {
  for (const flag of ["0", "1"]) {
    await withEnv(
      { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: flag },
      async () => {
        const getSessionUser = loadGetSessionUser(async () => ({
          user: { id: "8" },
        }));
        const result = await getSessionUser(headersWithCookies({}));
        assert.deepEqual(result, { userId: 8, source: "better-auth" });
      },
    );
  }
});

test("row 2: legacy valid, Better Auth absent -> legacy wins, skips Better Auth when flag is on", async () => {
  await withEnv(
    { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: "1" },
    async () => {
      const getSessionUser = loadGetSessionUser(neverCalled);
      const result = await getSessionUser(
        headersWithCookies({ [SESSION_COOKIE]: signSession({ id: 6 }) }),
      );
      assert.deepEqual(result, {
        userId: 6,
        source: "legacy",
        needsBridge: true,
      });
    },
  );
});

test("row 3: legacy and Better Auth agree -> same userId, flag skips the DB call", async () => {
  await withEnv(
    { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: "1" },
    async () => {
      const getSessionUser = loadGetSessionUser(neverCalled);
      const result = await getSessionUser(
        headersWithCookies({ [SESSION_COOKIE]: signSession({ id: 6 }) }),
      );
      assert.equal(result.userId, 6);
      // Documented divergence: full lookup would say source:'better-auth'
      // here. Nothing reads .source/.needsBridge today (grepped repo-wide).
      assert.equal(result.source, "legacy");
    },
  );
});

test("row 4: legacy and Better Auth disagree (account switch, HTPR-4170) -> legacy wins either way", async () => {
  for (const flag of ["0", "1"]) {
    await withEnv(
      { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: flag },
      async () => {
        const getSessionUser = loadGetSessionUser(async () => ({
          user: { id: "9" },
        }));
        const result = await getSessionUser(
          headersWithCookies({ [SESSION_COOKIE]: signSession({ id: 7 }) }),
        );
        assert.deepEqual(result, {
          userId: 7,
          source: "legacy",
          needsBridge: true,
        });
      },
    );
  }
});

test("row 5: a valid guest legacy cookie plus a valid, different real Better Auth session -> legacy wins in both modes, unchanged by this ticket", async () => {
  // This is HTPR-4170's existing, pre-existing precedence (legacy wins on
  // mismatch) — not something this ticket introduces or can make worse. The
  // actual guard against a guest cookie shadowing a real session lives in
  // /api/demo/guest (HTPR-5460), which depends on getSessionUser NEVER
  // returning null for an otherwise-signed-in user — proven in rows 1/9/10,
  // not on this precedence rule.
  for (const flag of ["0", "1"]) {
    await withEnv(
      { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: flag },
      async () => {
        const getSessionUser = loadGetSessionUser(async () => ({
          user: { id: "500" }, // real user
        }));
        const guestId = 900;
        const result = await getSessionUser(
          headersWithCookies({
            [SESSION_COOKIE]: signSession({ id: guestId }),
          }),
        );
        assert.deepEqual(result, {
          userId: guestId,
          source: "legacy",
          needsBridge: true,
        });
      },
    );
  }
});

test("row 6: neither cookie present -> null", async () => {
  for (const flag of ["0", "1"]) {
    await withEnv(
      { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: flag },
      async () => {
        const getSessionUser = loadGetSessionUser(async () => null);
        assert.equal(await getSessionUser(headersWithCookies({})), null);
      },
    );
  }
});

test("row 7: tampered legacy signature -> falls through to the unchanged full lookup", async () => {
  await withEnv(
    { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: "1" },
    async () => {
      const getSessionUser = loadGetSessionUser(async () => ({
        user: { id: "8" },
      }));
      const [payload] = signSession({ id: 6 }).split(".");
      const forged = `${payload}.${"a".repeat(43)}`;
      const result = await getSessionUser(
        headersWithCookies({ [SESSION_COOKIE]: forged }),
      );
      // legacySession is null (tampered), so the fast-path gate never fires;
      // Better Auth resolves it, exactly like today.
      assert.deepEqual(result, { userId: 8, source: "better-auth" });
    },
  );
});

test("row 8: expired legacy session -> falls through to the unchanged full lookup", async () => {
  await withEnv(
    { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: "1" },
    async () => {
      const getSessionUser = loadGetSessionUser(async () => ({
        user: { id: "8" },
      }));
      const expired = signSession({ id: 6 }, -1);
      const result = await getSessionUser(
        headersWithCookies({ [SESSION_COOKIE]: expired }),
      );
      assert.deepEqual(result, { userId: 8, source: "better-auth" });
    },
  );
});

test("row 9: legacy absent, malformed Better Auth response -> null (unchanged branch, flag has no effect)", async () => {
  for (const flag of ["0", "1"]) {
    for (const session of [
      { user: { id: "not-a-number" } },
      { user: null },
      {},
    ]) {
      await withEnv(
        { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: flag },
        async () => {
          const getSessionUser = loadGetSessionUser(async () => session);
          assert.equal(
            await getSessionUser(headersWithCookies({})),
            null,
            `expected ${JSON.stringify(session)} to fail closed`,
          );
        },
      );
    }
  }
});

test("row 10: legacy absent, Better Auth adapter throws -> fails closed instead of crashing (reinstated hardening)", async () => {
  for (const flag of ["0", "1"]) {
    await withEnv(
      { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: flag },
      async () => {
        const getSessionUser = loadGetSessionUser(async () => {
          throw new Error("adapter unavailable");
        });
        assert.equal(await getSessionUser(headersWithCookies({})), null);
      },
    );
  }
});

test("legacy valid, Better Auth adapter would throw -> the fast path never calls it, so it can't", async () => {
  await withEnv(
    { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: "1" },
    async () => {
      const getSessionUser = loadGetSessionUser(async () => {
        throw new Error("must not be called");
      });
      const result = await getSessionUser(
        headersWithCookies({ [SESSION_COOKIE]: signSession({ id: 6 }) }),
      );
      assert.equal(result.userId, 6);
    },
  );
});

test("the kill switch is off by default: unset AUTH_LEGACY_FAST_PATH runs the full lookup", async () => {
  await withEnv({ BETTER_AUTH_ENABLED: "1" }, async () => {
    delete process.env.AUTH_LEGACY_FAST_PATH;
    let called = false;
    const getSessionUser = loadGetSessionUser(async () => {
      called = true;
      return { user: { id: "6" } };
    });
    await getSessionUser(
      headersWithCookies({ [SESSION_COOKIE]: signSession({ id: 6 }) }),
    );
    assert.equal(called, true, "expected the full lookup to run by default");
  });
});

// --- Differential harness: fast path vs full lookup must agree on userId ---
//
// Same cookie input, same Better Auth mock, run once per flag value; the
// only permitted divergence is the row-3 source label (dead field today).

const differentialCells = [
  {
    name: "legacy absent, BA valid",
    cookies: {},
    getSession: async () => ({ user: { id: "8" } }),
  },
  {
    name: "legacy valid, BA absent",
    cookies: { [SESSION_COOKIE]: signSession({ id: 6 }) },
    getSession: async () => null,
  },
  {
    name: "legacy and BA agree",
    cookies: { [SESSION_COOKIE]: signSession({ id: 6 }) },
    getSession: async () => ({ user: { id: "6" } }),
  },
  {
    name: "legacy and BA disagree (account switch)",
    cookies: { [SESSION_COOKIE]: signSession({ id: 7 }) },
    getSession: async () => ({ user: { id: "9" } }),
  },
  {
    name: "guest legacy shadowed by real BA session",
    cookies: { [SESSION_COOKIE]: signSession({ id: 900 }) },
    getSession: async () => ({ user: { id: "500" } }),
  },
  {
    name: "neither cookie",
    cookies: {},
    getSession: async () => null,
  },
];

test("differential: fast path and full lookup return the same userId in every cell", async () => {
  for (const cell of differentialCells) {
    const withFlag = await withEnv(
      { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: "1" },
      async () => {
        const getSessionUser = loadGetSessionUser(cell.getSession);
        return getSessionUser(headersWithCookies(cell.cookies));
      },
    );
    const withoutFlag = await withEnv(
      { BETTER_AUTH_ENABLED: "1", AUTH_LEGACY_FAST_PATH: "0" },
      async () => {
        const getSessionUser = loadGetSessionUser(cell.getSession);
        return getSessionUser(headersWithCookies(cell.cookies));
      },
    );
    assert.equal(
      withFlag?.userId,
      withoutFlag?.userId,
      `userId diverged in cell "${cell.name}"`,
    );
    assert.equal(
      (withFlag === null) === (withoutFlag === null),
      true,
      `null-ness diverged in cell "${cell.name}"`,
    );
  }
});
