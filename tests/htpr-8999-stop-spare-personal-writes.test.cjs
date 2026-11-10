const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function activityDataAssignsMetadata(source) {
  const re = /\.(?:user_Activity|team_Activity)\.(?:create|update|upsert|updateMany)\([\s\S]{0,500}/g;
  for (const match of source.matchAll(re)) {
    const dataAt = match[0].search(/\bdata\s*:/);
    if (dataAt < 0) continue;
    if (/\bmetadata\s*:/.test(match[0].slice(dataAt, dataAt + 350))) return true;
  }
  return false;
}

const activityWriters = [
  "src/utils/controllers/users/provisionNewUser.ts",
  "src/utils/controllers/users/completeOnboardingStep.ts",
  "src/pages/api/teams/create.ts",
  "src/lib/demo/provisionGuest.ts",
  "src/pages/api/activity/addLastActiveAt.ts",
  "src/utils/controllers/tasks/create.ts",
  "src/utils/controllers/tasks/createTaskCore.ts",
  "src/lib/api/task-writes/create-global-effects.ts",
  "src/utils/controllers/stripe/webhook/onSubscriptionUpdated.ts",
];

test("htpr-8999-activity-spare-metadata-unwritten", () => {
  const schema = read("src/prisma/schema.prisma");
  assert.match(schema, /model User_Activity \{[\s\S]*metadata\s+Json\?/);
  assert.match(schema, /model Team_Activity \{[\s\S]*metadata\s+Json\?/);
  for (const file of activityWriters) {
    assert.equal(activityDataAssignsMetadata(read(file)), false, file);
  }
  assert.equal(
    activityDataAssignsMetadata(
      'prisma.user_Activity.create({ data: { userId: 1, metadata: { note: "x" } } })',
    ),
    true,
  );
});

test("htpr-8999-github-installation-login-not-stored", () => {
  const adopt = read("src/lib/github/adoptInstallation.ts");
  assert.doesNotMatch(adopt, /accountLogin:\s*installation\.accountLogin/);
  assert.match(adopt, /accountLogin:\s*""/);
  assert.match(read("src/lib/github/installAuthority.ts"), /installation\.accountLogin/);
  assert.match(read("src/lib/github/userApi.ts"), /accountLogin/);
});
