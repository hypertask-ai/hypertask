const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flagKey = "htpr-7553-email-straight-board";

function loadTs(relativePath, aliases = {}) {
  if (/src\/lib\/flags\/(?:keys|definitions)\.ts$/.test(relativePath)) {
    return require("./helpers/flag-files.cjs").load(relativePath);
  }
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", javascript)(
    (specifier) => aliases[specifier] ?? require(specifier),
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

test("flag definition is owner and qa with access high risk", () => {
  const def = loadTs("src/lib/flags/definitions/htpr-7553-email-straight-board.ts", {}).default;
  assert.equal(def.key, flagKey);
  assert.equal(def.defaultMode, "OWNER_AND_QA");
  assert.equal(def.releaseRisk.highRisk, "access");
});

test("straight-board rollout refuses guest requesters in server helper", () => {
  const src = fs.readFileSync(path.join(root, "src/lib/auth/emailStraightBoard.ts"), "utf8");
  assert.match(src, /straightBoardSignupRequesterAllowed[\s\S]*isGuestUser/);
  assert.match(src, /blockUnverifiedStraightBoardInvite[\s\S]*sessionEmailUnverified/);
});

test("invite endpoints mention confirm-email before inviting", () => {
  for (const file of [
    "src/pages/api/invite/createInviteLink.ts",
    "src/pages/api/invite/generatePublicInvite.ts",
  ]) {
    assert.match(fs.readFileSync(path.join(root, file), "utf8"), /Please confirm your email/);
  }
});
