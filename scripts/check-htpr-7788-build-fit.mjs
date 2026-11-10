import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const fail = (message) => {
  console.error(`build fit FAIL: ${message}`);
  process.exit(1);
};

const section = read("src/components/Modals/Settings/AiUsageSection.tsx");
const breakdown = read("src/components/Modals/Settings/AiUsageTeamsBreakdown.tsx");
const flag = read("src/lib/flags/definitions/htpr-7788-team-ai-breakdown.ts");
const list = read("src/app/api/settings/ai-usage/owned-teams/route.ts");

if (!/dynamic\(\s*\(\) => import\("\.\/AiUsageTeamsBreakdown"\)/.test(section))
  fail("the breakdown UI is not behind next/dynamic");
if (!/if \(teamBreakdown\) return <TeamAiUsageBreakdown \/>;/.test(section))
  fail("the flag does not hand rendering to the lazy breakdown");
if (/from "\.\/AiUsageTeamsBreakdown"/.test(section))
  fail("the breakdown is also statically imported, so nothing is lazy");

const allowedBreakdownImports = [
  "axios",
  "react",
  "./SettingsCard",
  "./SettingsSectionShell",
  "./useSettingsTeam",
  "./AiUsageSection",
];
for (const match of breakdown.matchAll(/from "([^"]+)"/g)) {
  if (!allowedBreakdownImports.includes(match[1])) fail(`unexpected breakdown import ${match[1]}`);
}

for (const line of [/defaultMode: "OWNER_AND_QA"/, /HTPR_7788_TEAM_AI_BREAKDOWN_FLAG/]) {
  if (!line.test(flag)) fail(`flag definition missing ${line}`);
}
if (!/isFeatureEnabled\(HTPR_7788_TEAM_AI_BREAKDOWN_FLAG/.test(list))
  fail("the owner list endpoint is not flag gated");
if (/members: \{ some/.test(list)) fail("the owner list endpoint widens to team members");

console.log("build fit ok");
