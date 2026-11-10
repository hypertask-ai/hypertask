import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const gatewayUsage = () => import("@/app/api/settings/ai-usage/gatewayUsage");

test("the team breakdown ships at Owner and QA behind its own flag", () => {
  const definition = read("src/lib/flags/definitions/htpr-7788-team-ai-breakdown.ts");
  const section = read("src/components/Modals/Settings/AiUsageSection.tsx");
  const breakdown = read("src/components/Modals/Settings/AiUsageTeamsBreakdown.tsx");
  assert.match(definition, /kind: "improvement"/);
  assert.match(definition, /defaultMode: "OWNER_AND_QA"/);
  assert.match(section, /useFlag\(HTPR_7788_TEAM_AI_BREAKDOWN_FLAG\)/);
  assert.match(section, /dynamic(?:<[^>]+>)?\(\s*\(\) => import\("\.\/AiUsageTeamsBreakdown"\)/);
  assert.match(section, /if \(teamBreakdown\) return <TeamAiUsageBreakdown \/>;/);
  assert.match(breakdown, /\/api\/settings\/ai-usage\/owned-teams/);
  assert.match(breakdown, /members\.length > 0/);
});

test("only the team owner reaches the team-wide list and member rows", () => {
  const list = read("src/app/api/settings/ai-usage/owned-teams/route.ts");
  const usage = read("src/app/api/settings/ai-usage/route.ts");
  assert.match(list, /isFeatureEnabled\(HTPR_7788_TEAM_AI_BREAKDOWN_FLAG/);
  assert.match(list, /googleAccount: \{ userId: user\.id \}/);
  assert.doesNotMatch(list, /members: \{ some/, "team members stay out");
  assert.match(usage, /isTeamOwner &&\s*\n\s*!customerFunded &&\s*\n\s*\(await isFeatureEnabled\(HTPR_7788_TEAM_AI_BREAKDOWN_FLAG/);
  assert.match(usage, /buildGatewayMemberSpendRows\(/);
});
test("member spend rows reconcile to the team total", async () => {
  const { buildGatewayMemberSpendRows } = await gatewayUsage();
  const tag = { results: [
    { tag: "user:1", total_cost: "3.5" },
    { tag: "user:2", total_cost: "1.25" },
    { tag: "included-with-hypertask", total_cost: "2" },
  ] };
  assert.deepEqual(
    buildGatewayMemberSpendRows(
      [{ displayName: "Ada", userId: 1 }, { displayName: "Bo", userId: 2 }, { displayName: "Cy", userId: 3 }],
      tag,
      10,
    ),
    [{ label: "Ada", value: 3.5 }, { label: "Bo", value: 1.25 }, { label: "Cy", value: 0 }, { label: "Other / agents", value: 5.25 }],
  );
  assert.deepEqual(
    buildGatewayMemberSpendRows([{ displayName: "Ada", userId: 1 }], { results: [{ tag: "user:1", total_cost: "12" }] }, 8),
    [{ label: "Ada", value: 12 }],
  );
});
