const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("getTeamInviteUrl returns before the team lookup when no team id is given", () => {
  const source = read("src/lib/serverActions/index.ts");
  const start = source.indexOf("export const getTeamInviteUrl");
  assert.ok(start >= 0, "getTeamInviteUrl exists");
  const body = source.slice(start, source.indexOf("\nexport ", start + 1));
  const guard = body.search(/if \(!teamId\) return "Error"/);
  const lookup = body.indexOf("prisma.team.findUnique");
  assert.ok(guard >= 0, "guard on a missing team id");
  assert.ok(lookup > guard, "guard runs before prisma.team.findUnique");
});

test("the invite step skips the invite link request when there is no team", () => {
  const source = read("src/components/PageComponents/Onboarding/Screens/OnboardingScreen5.tsx");
  assert.match(source, /if \(!currentUser \|\| !teamToInviteTo\?\.id\) return;/);
  assert.doesNotMatch(source, /getTeamInviteUrl\([^)]*teamToInviteTo\.id\)[\s\S]*\}, \[currentUser\]\)/);
});
