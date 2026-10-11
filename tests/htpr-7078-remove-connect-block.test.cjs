const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const landing = fs.readFileSync("src/app/[...boardURL]/LandingPage.tsx", "utf8");
const flag = fs.readFileSync("src/lib/flags/definitions/htpr-7078-remove-connect-block.ts", "utf8");

test("the flag is a bugfix flag that is on for everyone", () => {
  assert.match(flag, /kind: "bugfix"/);
  assert.match(flag, /defaultMode: "EVERYONE"/);
});

test("the Connect your agent block renders only when the flag is off", () => {
  assert.match(landing, /const connectBlockRemoved = useFlag\(HTPR_7078_REMOVE_CONNECT_BLOCK_FLAG\)/);
  assert.match(landing, /\{!connectBlockRemoved && _currentProject && _currentUser\?\.id && \(\s*<AgentConnectCard/);
  assert.equal(landing.match(/<AgentConnectCard/g).length, 1);
});

test("the card component and onboarding helpers stay in place", () => {
  assert.ok(fs.existsSync("src/components/PageComponents/Onboarding/AgentConnectCard.tsx"));
  assert.ok(fs.existsSync("src/lib/onboarding/agentConnection.ts"));
});
