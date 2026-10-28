const test = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const flag = "htpr-7699-desktop-cli-token";
const user = { id: 985, email: "member@example.test", displayName: "Member" };

for (const mode of ["enabled", "disabled", "unavailable"]) {
  test(`AI request: desktop identity is ${mode === "enabled" ? "allowed" : "refused"} when the flag is ${mode}`, async () => {
    const { getAiRequestUser } = load("src/app/api/ai/_lib/requestUser.ts", {
      "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => ({ ...user, source: "cli-bearer" }) },
      "@/lib/flags": {
        HTPR_7699_DESKTOP_CLI_TOKEN_FLAG: flag,
        isFeatureEnabled: async (...args) => {
          assert.deepEqual(args, [flag, user.id]);
          if (mode === "unavailable") throw new Error("Flag store unavailable");
          return mode === "enabled";
        },
      },
      "@/lib/mcp/auth": { validateMcpAuth: async () => { throw new Error("No alternate credential allowed"); } },
    });
    const result = await getAiRequestUser(new NextRequest("https://app.example.test/api/ai/task-writer"));
    assert.deepEqual(result, mode === "enabled" ? { ...user, source: "cli-bearer" } : null);
  });
}

test("AI request: browser identity remains allowed without the desktop flag", async () => {
  const { getAiRequestUser } = load("src/app/api/ai/_lib/requestUser.ts", {
    "@/app/api/ai/_lib/editorAi": { getCurrentUserFromCookies: async () => user },
    "@/lib/flags": { isFeatureEnabled: async () => { throw new Error("Browser login must not read the desktop flag"); } },
    "@/lib/mcp/auth": { validateMcpAuth: async () => { throw new Error("Browser identity already selected"); } },
  });
  assert.deepEqual(await getAiRequestUser(new NextRequest("https://app.example.test/api/ai/task-writer")), user);
});
