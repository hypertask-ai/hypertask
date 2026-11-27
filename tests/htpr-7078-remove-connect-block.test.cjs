const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { definitions } = require("./helpers/flag-files.cjs");

const connectBlockFlag = definitions().find(({ key }) => key === "htpr-7078-remove-connect-block");

test("the inline card stays removed without a flag", () => {
  assert.equal(connectBlockFlag, undefined);
  const landing = fs.readFileSync("src/app/[...boardURL]/LandingPage.tsx", "utf8");
  assert.doesNotMatch(landing, /AgentConnectCard|connectBlockRemoved|inlineConnectCard/);
});

test("the card component and onboarding helpers stay in place", () => {
  assert.ok(fs.existsSync("src/components/PageComponents/Onboarding/AgentConnectCard.tsx"));
  assert.ok(fs.existsSync("src/lib/onboarding/agentConnection.ts"));
});
