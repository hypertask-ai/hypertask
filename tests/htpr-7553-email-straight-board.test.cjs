const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

test("straight-board flag and guards are wired on server paths", () => {
  const def = ts.transpileModule(
    fs.readFileSync(path.join(root, "src/lib/flags/definitions/htpr-7553-email-straight-board.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  );
  assert.match(def.outputText, /OWNER_AND_QA/);
  const server = fs.readFileSync(path.join(root, "src/lib/auth/emailStraightBoard.ts"), "utf8");
  assert.match(server, /isGuestUser/);
  assert.match(fs.readFileSync(path.join(root, "src/pages/api/invite/createInviteLink.ts"), "utf8"), /Please confirm your email/);
});
