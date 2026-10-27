const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const load = require("jiti")(__filename, { fsCache: false });
const flag = load(path.join(__dirname, "../src/lib/flags/definitions/htpr-7857-heartbeat-step-cap.ts"));

test("heartbeat cap ships as a reversible, low-risk improvement", () => {
  assert.equal(flag.HTPR_7857_HEARTBEAT_STEP_CAP_FLAG, "htpr-7857-heartbeat-step-cap");
  assert.equal(flag.default.key, "htpr-7857-heartbeat-step-cap");
  assert.equal(flag.default.kind, "improvement");
  assert.equal(flag.default.defaultMode, "EVERYONE");
  assert.equal(flag.default.releaseRisk.risk, "small");
  assert.equal(flag.default.releaseRisk.highRisk, undefined);
});
