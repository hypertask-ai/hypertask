const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");

const root = path.resolve(__dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

function runBlock(workflow) {
  const marker = "        run: |\n";
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, "run block not found");
  const lines = workflow.slice(start + marker.length).split("\n");
  const block = [];
  for (const line of lines) {
    if (line === "") {
      block.push("");
      continue;
    }
    const indent = (line.match(/^ */) || [""])[0].length;
    if (indent <= 8) break;
    block.push(line.slice(10));
  }
  return block.join("\n");
}

test("runtime log workflow contract", () => {
  const source = read(".github/workflows/vercel-runtime-log.yml");
  const workflow = yaml.load(source);
  const [jobName] = Object.keys(workflow.jobs);
  const job = workflow.jobs[jobName];

  assert.equal(job["runs-on"], "ubuntu-latest", "must run on a GitHub-hosted runner");
  assert.equal(job["timeout-minutes"], 5);
  assert.doesNotMatch(source, /self-hosted/);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.ticket.required, true);
  assert.equal(workflow.permissions.contents, "read");

  const script = runBlock(source);
  assert.match(script, /\[\[ "\$TICKET" =~ \^\[0-9\]\{1,7\}\$ \]\]/, "ticket is validated");
  assert.match(script, /\[\[ "\$BOARD" =~ \^\[0-9\]\{1,7\}\$ \]\]/, "project is validated");
  assert.match(script, /\[ "\$LIMIT" -le 500 \]/, "limit is bounded to Vercel's page size");
  assert.match(script, /\[\[ -z "\$LEVEL" \|\| "\$LEVEL" =~ \^\(error\|warn\|info\)\$ \]\]/, "level is whitelisted");
  assert.match(script, /filter="environment:production"/, "the query pins production like vercel-logs.mjs");
  assert.match(script, /https:\/\/api\.vercel\.com\/v1\/observability\/events\?teamId=\$TEAM_ID/, "reads the API host runners can reach");
  assert.match(script, /x-vercel-observability-query-reason: cli\/logs-runtime/, "sends the same query reason as the collector script");
  assert.match(script, /page=\$\(\[ -n "\$SEARCH" \] && echo 500 \|\| echo "\$LIMIT"\)/, "a local search reads the widest page");
  assert.match(script, /case "\$code" in\n\s+200\|201\|202\)/, "an agent-lane 202 counts as posted");
  assert.match(script, /https:\/\/app\.hypertask\.ai\/api\/mcp\/agents\/runs/, "opens a ticket run, not a people comment");
  assert.match(script, /api\/mcp\/agents\/runs\/\$RUN_ID\/activities/, "delivers the log to the ticket agent lane only");
  assert.doesNotMatch(script, /api\/mcp\/comments/, "a people comment needs an audience and refuses raw log text");
  assert.doesNotMatch(script, /cat \/tmp\/lines\.txt/, "raw log lines never reach the Actions output");
  assert.doesNotMatch(script, /\$\{\{ secrets\./, "secrets arrive through env, never interpolated into the shell");
  assert.match(script, /sed -E -e 's#\[a-z\]\+:\/\/\[\^\[:space:\]\]\*@/, "credentials in URLs are redacted");
  console.log("runtime-log-workflow ok");
});

test("build log comment acceptance", () => {
  const source = read(".github/workflows/vercel-deploy-log.yml");
  const acceptance = /case "\$code" in\n([\s\S]*?)\n\s+esac/.exec(source);
  assert.ok(acceptance, "the comment acceptance block is present");
  const block = acceptance[0].replace(/^\s{10}/gm, "");
  const run = (code) => spawnSync("bash", ["-c", `code=${code}\n${block}`], { encoding: "utf8" });
  for (const accepted of [200, 201, 202]) {
    const result = run(accepted);
    assert.equal(result.status, 0, `HTTP ${accepted} must not fail the job: ${result.stdout}${result.stderr}`);
  }
  const refused = run(500);
  assert.equal(refused.status, 1, "a real failure still fails the job");
  console.log("build-log-workflow ok");
});

test("read path documentation", () => {
  const readme = read(".claude/skills/ship/scripts/error-collector/README.md");
  const section = readme.slice(readme.indexOf("## Read production logs by hand"));
  assert.match(section, /Vercel Security Checkpoint/, "names the block a runner hits");
  assert.match(section, /api\.vercel\.com/, "says the API host is challenged too");
  assert.match(section, /vercel-runtime-log\.yml/, "names the working read path");
  assert.match(section, /vercel-deploy-log\.yml/, "names the build log path");
  assert.doesNotMatch(section, /`api\.vercel\.com` is not challenged/, "the superseded claim is gone");
  console.log("log-read-docs ok");
});
