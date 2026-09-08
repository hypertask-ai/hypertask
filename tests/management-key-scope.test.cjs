const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { managementKeyScopeLabel, managementKeyTeamLabel } = jiti(
  path.join(root, "src/components/Modals/Settings/managementKeyScope.ts"),
);

test("team labels distinguish disabled team keys from account keys", () => {
  assert.equal(managementKeyTeamLabel(true, null, false), "Team key disabled");
  assert.equal(managementKeyTeamLabel(false, null, false), null);
  assert.equal(managementKeyTeamLabel(false, null, true), "Whole account");
  assert.equal(managementKeyTeamLabel(true, null, true), "Team unavailable");
  assert.equal(
    managementKeyTeamLabel(true, { title: "Team A" }, true),
    "Team A",
  );
});

test("scope labels distinguish valid full keys from restricted keys", () => {
  const fullPermissions = {
    management: ["read", "write"],
    data: ["read", "write"],
    usage: ["read"],
  };

  assert.equal(managementKeyScopeLabel(fullPermissions), "Full account access");
  assert.equal(
    managementKeyScopeLabel({
      management: ["read", "write"],
      data: ["read", "write"],
    }),
    "Full account access",
  );

  for (const usage of [[], ["write"]]) {
    assert.equal(
      managementKeyScopeLabel({
        management: ["read", "write"],
        data: ["read", "write"],
        usage,
      }),
      "Unknown",
    );
  }
});

test("narrow key scope labels remain unchanged", () => {
  assert.equal(managementKeyScopeLabel({ usage: ["read"] }), "Usage only");
  assert.equal(
    managementKeyScopeLabel({ management: ["read", "write"] }),
    "Management only",
  );
});
