const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");

test("straight-board flag and guards are wired on server paths", () => {
  const def = loadModule("src/lib/flags/definitions/htpr-7553-email-straight-board.ts").default;
  assert.equal(def.key, "htpr-7553-email-straight-board");
  assert.equal(def.defaultMode, "OWNER_AND_QA");
  assert.equal(def.releaseRisk.highRisk, "access");
  const server = fs.readFileSync(path.join(root, "src/lib/auth/emailStraightBoard.ts"), "utf8");
  assert.match(server, /isGuestUser/);
  assert.match(fs.readFileSync(path.join(root, "src/pages/api/invite/createInviteLink.ts"), "utf8"), /Please confirm your email/);
});
