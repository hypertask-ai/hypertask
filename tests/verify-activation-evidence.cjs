const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const folder = path.join(os.homedir(), ".local/state/vcc-evidence/HTPR-7034");
const payloads = JSON.parse(fs.readFileSync(path.join(folder, "local-events.json"), "utf8"));
const events = ["board_created", "agent_connected", "agent_task_completed", "teammate_invited", "invite_accepted", "lifecycle_email_sent"];
assert.deepEqual([...new Set(payloads.map((payload) => payload.event))].sort(), events.sort());
for (const payload of payloads) {
  assert.equal(payload.distinctId, "123");
  assert.equal(typeof payload.properties, "object");
  for (const key of Object.keys(payload.properties)) assert.ok(!/token|key|email|secret|password/i.test(key));
}
const boardSources = payloads.filter(({ event }) => event === "board_created").map(({ properties }) => properties.source);
assert.deepEqual(boardSources.sort(), ["adopted_demo", "manual", "seeded"]);
assert.deepEqual(payloads.filter(({ event }) => event === "teammate_invited").map(({ properties }) => properties.method).sort(), ["email", "link"]);
assert.deepEqual(payloads.filter(({ event }) => event === "agent_task_completed").map(({ properties }) => properties.is_first), [true, false, true, false, true, false]);
const wiring = fs.readFileSync(path.join(folder, "wiring.md"), "utf8");
assert.ok(wiring.includes("Owner + QA"));
assert.ok(wiring.includes("htpr-7034-activation-analytics"));
assert.ok(wiring.includes("mocked"));
const citations = [...wiring.matchAll(/(src\/[\w./-]+\.ts):(\d+)/g)];
assert.ok(citations.length >= 12);
for (const [, file, line] of citations) {
  const source = fs.readFileSync(file, "utf8").split("\n");
  assert.ok(source[Number(line) - 1]?.trim(), `${file}:${line} must cite a real source line`);
}
assert.equal(wiring.includes("\u2014"), false);
console.log("activation evidence verified");
