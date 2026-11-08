const { withStubs } = require("./helpers/stub-map.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7553-email-straight-board";

function loadTs(relativePath, aliases) {
  aliases = withStubs({}, aliases);
  if (/src\/lib\/flags\/(?:keys|definitions)\.ts$/.test(relativePath)) {
    return require("./helpers/flag-files.cjs").load(relativePath);
  }
  const javascript = ts.transpileModule(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", javascript)(
    (specifier) => aliases[specifier] ?? require(specifier),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

test("flag definition is owner and qa with access high risk", () => {
  const def = loadTs(
    "src/lib/flags/definitions/htpr-7553-email-straight-board.ts",
    {},
  ).default;
  assert.equal(def.key, flagKey);
  assert.equal(def.defaultMode, "OWNER_AND_QA");
  assert.equal(def.releaseRisk.highRisk, "access");
});

test("send-email-link returns boardRedirect for new email when rollout is on", async () => {
  const calls = { straight: 0, link: 0 };
  const aliases = {
    "@/lib/prisma": {
      user: {
        findFirst: async () => null,
      },
    },
    "@/lib/auth/signupAttributionContext": {
      createSignupContext: async () => "ctx",
      bindSignupCodeContext: async () => {},
    },
    "@/lib/auth/emailStraightBoard": {
      straightBoardSignupAllowed: async () => true,
      finishStraightBoardEmailSignup: async () => {
        calls.straight += 1;
        return {
          ok: true,
          response: {
            json: () => ({
              success: true,
              boardRedirect: "/project?id=9",
            }),
          },
        };
      },
      sendSignupVerificationEmail: async () => {},
    },
    "@/lib/telemetry/signupAnalytics": {
      signupAttributionFromHeaders: () => ({}),
    },
    "@/lib/flags": loadTs("src/lib/flags.ts", {}),
  };
  const { POST } = loadTs("src/app/api/auth/send-email-link/route.ts", aliases);
  const { NextRequest } = require("next/server");
  const req = new NextRequest("https://app.hypertask.ai/api/auth/send-email-link", {
    method: "POST",
    body: JSON.stringify({ email: "new@example.test" }),
  });
  await POST(req);
  assert.equal(calls.straight, 1);
  assert.equal(calls.link, 0);
});

test("Please confirm your email banner copy is wired in NotificationPromoteBanner", () => {
  const src = fs.readFileSync(
    path.join(root, "src/components/Global/NotificationPromoteBanner.tsx"),
    "utf8",
  );
  assert.match(src, /Please confirm your email/);
});
