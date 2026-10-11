const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const changed = spawnSync("git", ["diff", "--name-only", "origin/production", "--"], { encoding: "utf8" });
assert.equal(changed.status, 0);
const touched = [...changed.stdout.trim().split("\n"), "src/lib/telemetry/activationAnalytics.ts", "src/lib/telemetry/activationOccurrences.ts"].filter((file) => file.startsWith("src/"));
const references = touched.flatMap((file) => [file, file.replace(/^src\//, "@/"), file.replace(/^src\//, "").replace(/\.tsx?$/, "")]);
const authReference = /onboarding\/emails\/welcome|oauth\/token|agentConnection|sectionService|lib\/ai\/tools\/section|agentFirstTaskEmail|token-exchange|verifyJwt|ai-connection-status|mcp[\/.-]auth|validateMcpAuth|validateJwtToken/;
const files = fs.readdirSync("tests", { recursive: true }).filter((file) => /\.test\.(ts|cjs)$/.test(file)).map((file) => path.join("tests", file));
const helperReferences = fs.readdirSync("tests/helpers").filter((file) => {
  const source = fs.readFileSync(path.join("tests/helpers", file), "utf8");
  return authReference.test(source) || references.some((reference) => source.includes(reference));
}).map((file) => `helpers/${file.replace(/\.(ts|cjs)$/, "")}`);
const selected = files.filter((file) => {
  const source = fs.readFileSync(file, "utf8");
  return /activation-/.test(file) || authReference.test(source) || references.some((reference) => source.includes(reference)) || helperReferences.some((helper) => source.includes(helper));
});
for (const required of ["tests/feature-flags.test.cjs", "tests/file-size-limit.test.cjs", "tests/signup-analytics.test.ts", "tests/activation-analytics.test.ts", "tests/activation-wiring.test.ts"]) {
  if (!selected.includes(required)) selected.push(required);
}
const evidence = path.join(os.homedir(), ".local/state/vcc-evidence/HTPR-7034");
fs.mkdirSync(evidence, { recursive: true });
fs.writeFileSync(path.join(evidence, "related-tests.json"), JSON.stringify(selected.sort(), null, 2) + "\n");
const result = spawnSync(process.execPath, ["scripts/run-tests.mjs", ...selected], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${path.resolve("tests/helpers/register-server-only.cjs")}`.trim(), POSTHOG_SERVER_PROJECT_TOKEN: "", DATABASE_URL: "postgresql://local_test:local_test@127.0.0.1:1/local_test" },
});
const output = (result.stdout ?? "") + (result.stderr ?? "");
fs.writeFileSync(path.join(evidence, "regressions.log"), output);
if (result.status !== 0) console.error(output.split("\n").filter((line) => /^not ok|^# fail [1-9]|Cannot find module|Unexpected import/.test(line)).join("\n"));
assert.equal(result.status, 0, "activation related regressions failed; see evidence regressions.log");
console.log(`activation regressions passed (${selected.length} test files)`);
