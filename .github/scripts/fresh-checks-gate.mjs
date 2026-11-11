import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPins, checksAreFresh, planFreshChecks, requireFreshChecks } from "./require-fresh-checks.mjs";

const live = {
  name: "production-required-checks",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/heads/production"], exclude: [] } },
  rules: [
    { type: "deletion", parameters: { blocked: true } },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [
          { context: "ci-tests", integration_id: 15368 },
          { context: "premerge-evidence" },
        ],
      },
    },
  ],
};

function pins() {
  if (checksAreFresh(live)) throw new Error("stale fixture was already fresh");
  const plan = planFreshChecks(structuredClone(live));
  if (plan.action !== "put") throw new Error("stale ruleset was not a write");
  if (live.rules[1].parameters.strict_required_status_checks_policy !== false) throw new Error("planner mutated its input");
  const fresh = plan.body;
  if (fresh.rules[0].type !== "deletion" || fresh.rules[0].parameters.blocked !== true) throw new Error("another rule changed");
  if (fresh.rules[1].parameters.strict_required_status_checks_policy !== true) throw new Error("strict policy was not set");
  if (fresh.rules[1].parameters.do_not_enforce_on_create !== false) throw new Error("create enforcement changed");
  if (JSON.stringify(checkPins(fresh)) !== JSON.stringify(checkPins(live))) throw new Error("check pins changed");
  if (Object.prototype.hasOwnProperty.call(fresh.rules[1].parameters.required_status_checks[1], "integration_id")) {
    throw new Error("missing integration pin was invented");
  }
  const already = structuredClone(live);
  already.rules[1].parameters.strict_required_status_checks_policy = true;
  if (planFreshChecks(already).action !== "noop") throw new Error("fresh ruleset was written again");
  if (!checksAreFresh(fresh)) throw new Error("written body is not fresh");
  let refused = false;
  try { requireFreshChecks({ ...live, name: "other" }); } catch { refused = true; }
  if (!refused) throw new Error("wrong ruleset name was accepted");
  console.log("FRESH_CHECKS_PRESERVED");
}

const contexts = [
  "app-smoke", "ci-tests", "ai-review", "claude-review", "feature-flag-gate",
  "next-public-secrets", "pr-title", "secret-scan", "browser-smoke", "premerge-evidence",
];

function monitorOnce(strict) {
  const directory = mkdtempSync(join(tmpdir(), "fresh-checks-gate-"));
  const parameters = {
    required_status_checks: contexts.map((context) => ({ context })),
  };
  if (strict !== "omit") parameters.strict_required_status_checks_policy = strict;
  const ruleset = {
    target: "branch",
    conditions: { ref_name: { include: ["refs/heads/production"], exclude: [] } },
    rules: [{ type: "required_status_checks", parameters }],
  };
  try {
    const payload = JSON.stringify(ruleset);
    writeFileSync(join(directory, "git"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
    writeFileSync(join(directory, "gh"), `#!/bin/sh
case "$3" in
  repos/test/repo) body='{"default_branch":"production"}' ;;
  'repos/test/repo/rulesets?per_page=100') body='[{"id":42,"name":"production-required-checks","enforcement":"active"}]' ;;
  repos/test/repo/rulesets/42) body='${payload}' ;;
  *) exit 99 ;;
esac
printf 'HTTP/2.0 200 OK\\r\\ncontent-type: application/json\\r\\n\\r\\n%s\\n' "$body"
`, { mode: 0o755 });
    return spawnSync(process.execPath, [".github/scripts/verify-required-check-settings.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 15_000,
      env: {
        PATH: directory,
        REPO: "test/repo",
        GITHUB_EVENT_NAME: "schedule",
        SETTINGS_PROOF: join(directory, "proof.json"),
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function monitor() {
  const stale = monitorOnce(false);
  const missing = monitorOnce("omit");
  const fresh = monitorOnce(true);
  if (stale.status === 0 || missing.status === 0) throw new Error("stale policy was accepted");
  const staleOutput = `${stale.stdout}${stale.stderr}${missing.stdout}${missing.stderr}`;
  if (!staleOutput.includes("do not require an up-to-date branch")) throw new Error("stale policy failed for another reason");
  if (fresh.status !== 0) throw new Error(fresh.stderr || fresh.stdout);
  if (!`${fresh.stdout}${fresh.stderr}`.includes("Required-check settings verified:")) throw new Error("fresh policy was not verified");
  console.log("UP_TO_DATE_BRANCH_REQUIRED");
}

const mode = process.argv[2];
if (mode === "pins") pins();
else if (mode === "monitor") monitor();
else {
  console.error("use pins or monitor");
  process.exitCode = 1;
}
