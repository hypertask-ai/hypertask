const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { definitions } = require("./helpers/flag-files.cjs");

const connectBlockFlag = definitions().find(({ key }) => key === "htpr-7078-remove-connect-block");

test("the flag is a bugfix flag that is on for everyone", () => {
  assert.ok(connectBlockFlag, "htpr-7078-remove-connect-block must stay defined");
  assert.equal(connectBlockFlag.kind, "bugfix");
  assert.equal(connectBlockFlag.defaultMode, "EVERYONE");
});

test("the card component and onboarding helpers stay in place", () => {
  assert.ok(fs.existsSync("src/components/PageComponents/Onboarding/AgentConnectCard.tsx"));
  assert.ok(fs.existsSync("src/lib/onboarding/agentConnection.ts"));
});
