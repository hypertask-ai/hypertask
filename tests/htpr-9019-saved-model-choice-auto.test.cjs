const assert = require("node:assert/strict");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const preferences = loadModule("src/lib/aiModelPreferences.ts");
test("saved Auto is scoped by surface and a later team pick wins", () => {
  const auto = preferences.storedAutoModelRequested;
  assert.equal(auto({ aiChat: "auto" }, "aiChat", null), true);
  assert.equal(auto({ teams: { 12: { askAi: "auto" } } }, "askAi", 12), true);
  assert.equal(auto({ teams: { 12: { askAi: "auto" } } }, "askAi", 13), false);
  assert.equal(auto({ aiChat: "auto", teams: { 12: { aiChat: "claude-haiku-5-5" } } }, "aiChat", 12), false);
  assert.equal(auto({ aiChat: "auto" }, "taskWriter", null), false);
});

test("Auto runs before the older reset so its backup keeps the original choice", async () => {
  for (const result of ["done", "switched", "failed"]) {
    const calls = [];
    const { ensureHtpr7038ModelReset } = loadModule("src/lib/ai/htpr7038ModelReset.ts", {
      react: { cache: (fn) => fn },
      "@/lib/ai/htpr9019ModelChoiceAuto": { ensureHtpr9019ModelChoiceAuto: async () => { calls.push("auto"); return result; } },
      "@/lib/prisma": { default: { htpr7038ModelChoiceResetDone: { findUnique: async () => { calls.push("haiku"); return { userId: 1 }; } } } },
      "@/lib/redis": {},
    });
    assert.equal(await ensureHtpr7038ModelReset(1), result === "failed" ? "failed" : "done");
    assert.deepEqual(calls, result === "failed" ? ["auto"] : ["auto", "haiku"]);
  }
});
