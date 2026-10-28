const test = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const origin = "https://app.example.test";

for (const target of ["flags", "team-comp", "qa-arm"]) {
  test(`${target}: selected CLI bypasses browser origin; cookies retain it`, async () => {
    let source = "cli-bearer";
    let userId = 985;
    const mocks = {
      "@/lib/auth/getSessionUser": { getSessionUser: async () => userId ? { userId, source, teamScope: null } : null },
      "@/lib/flags": { isFeatureFlagOwner: async () => Boolean(userId), FEATURE_FLAG_QA_USER: { userId: 985, email: "qa@example.test" }, FEATURE_FLAG_OWNER_USER_ID: 985, FEATURE_FLAG_MODES: ["OFF", "EVERYONE"], FeatureFlagInputError: class extends Error {} },
      "@/lib/flags/http": { noStore: (body, status = 200) => Response.json(body, { status }) },
      "@/lib/realtime/server": {},
      "@/lib/prisma": { default: { user: { findUnique: async () => ({ email: "qa@example.test" }) } } },
      "@/lib/redis": { getRedis: async () => { throw new Error("invalid input must not arm email"); } },
      "@/lib/auth/requestBaseUrl": { getRequestBaseUrl: () => origin },
      "@/lib/teamComp": { TEAM_COMP_PLANS: ["Pro"] },
      "@/lib/teamCompAdmin": { TeamCompLookupError: class extends Error {} },
    };
    const file = target === "qa-arm" ? "src/app/api/onboarding/emails/qa-arm/route.ts" : `src/app/api/admin/${target}/route.ts`;
    const method = target === "flags" ? "PATCH" : "POST";
    const handler = load(file, mocks)[method];
    const call = requestOrigin => handler(new NextRequest(`${origin}/api/fixture`, { method, headers: { "Content-Type": "application/json", host: "app.example.test", ...(requestOrigin ? { origin: requestOrigin } : {}), Authorization: "Bearer present-but-not-authority" }, body: JSON.stringify({ type: "invalid" }) }));
    assert.equal((await call()).status, 400);
    source = "legacy";
    assert.equal((await call()).status, 403);
    assert.equal((await call("https://foreign.example.test")).status, 403);
    assert.equal((await call(origin)).status, 400);
    userId = 0;
    assert.ok([403, 404].includes((await call(origin)).status));
  });
}

test("signup checkout uses selected CLI identity and retains cookie origin protection", async () => {
  const oldBase = process.env.NEXT_PUBLIC_BASEURL;
  process.env.NEXT_PUBLIC_BASEURL = origin;
  let source = "cli-bearer";
  let userId = 985;
  const called = [];
  try {
    const handler = load("src/pages/api/stripe/session/checkout.ts", {
      "@/lib/auth/getSessionUser": { getSessionUser: async () => userId ? { userId, source, teamScope: null } : null },
      "@/lib/auth/desktopCliTokenUser": { logDesktopCliResponse() {} },
      "@/lib/demo/guestGuard": { isGuestRequest: async () => false },
      "@/utils/controllers/stripe/createAuthorizedCheckoutSession": { createAuthorizedCheckoutSession: async id => { called.push(id); return { status: 400, body: { message: "Invalid fixture checkout" } }; } },
    }).default;
    const call = async requestOrigin => {
      const req = { method: "POST", headers: { ...(requestOrigin ? { origin: requestOrigin } : {}) }, body: { intent: "signup-straight-to-board", userId: 77 }, cookies: {} };
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {} };
      await handler(req, res);
      return res;
    };
    assert.equal((await call()).statusCode, 400);
    assert.deepEqual(called, [985]);
    source = "legacy";
    assert.equal((await call()).statusCode, 403);
    assert.equal((await call("https://foreign.example.test")).statusCode, 403);
    assert.deepEqual(called, [985]);
    assert.equal((await call(origin)).statusCode, 400);
    userId = 0;
    assert.equal((await call(origin)).statusCode, 401);
  } finally {
    if (oldBase === undefined) delete process.env.NEXT_PUBLIC_BASEURL;
    else process.env.NEXT_PUBLIC_BASEURL = oldBase;
  }
});
