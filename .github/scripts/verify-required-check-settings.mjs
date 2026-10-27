import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const maxWaitSeconds = 3900;
const deadline = Date.now() + 4_000_000;
let waitedSeconds = 0;

function needsVerification() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") return true;
  try {
    const { pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const base = pr.base.sha;
    const head = pr.head.sha;
    if (![base, head].every((sha) => /^[0-9a-f]{40}$/.test(sha))) throw new Error();
    const fetch = spawnSync("git", ["fetch", "--no-tags", "--depth=1", "origin", base, head], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    });
    if (fetch.status !== 0) throw new Error();
    const diff = spawnSync("git", ["diff", "--name-only", "--no-renames", "-z", base, head], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    });
    if (diff.status !== 0 || !diff.stdout.endsWith("\0")) throw new Error();
    const files = diff.stdout.slice(0, -1).split("\0");
    return files.some((file) => file.startsWith(".github/") || file === "docs/ci-policy.yml" || file === "docs/ci.md");
  } catch {
    console.log("Required-check settings: changed files unknown; verifying (fail-closed).");
    return true;
  }
}

function readSettings(endpoint) {
  for (;;) {
    if (Date.now() + 30_000 > deadline) throw new Error("Settings verification exceeded its time budget.");
    const response = spawnSync("gh", ["api", "--include", endpoint], {
      encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    });
    const output = response.stdout || "";
    const boundary = /\r?\n\r?\n/.exec(output);
    if (!boundary) throw new Error("GitHub settings read failed: missing HTTP response headers.");
    const headerLines = output.slice(0, boundary.index).split(/\r?\n/);
    const status = Number(/^HTTP\/\S+ (\d{3})/.exec(headerLines.shift())?.[1]);
    const headers = new Map(headerLines.map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
    }));
    const body = output.slice(boundary.index + boundary[0].length);
    if (response.status === 0 && status >= 200 && status < 300) return JSON.parse(body);

    const rateLimited = (status === 403 || status === 429) && (
      status === 429 || headers.get("x-ratelimit-remaining") === "0" ||
      headers.has("retry-after") || /(?:api|secondary) rate limit|rate limit exceeded/i.test(body)
    );
    if (!rateLimited) throw new Error(`GitHub settings read failed (HTTP ${status || "unknown"}); not a rate limit.`);

    const now = Date.now();
    const waits = [];
    const reset = headers.get("x-ratelimit-reset");
    if (/^\d+$/.test(reset)) waits.push(Math.ceil((Number(reset) * 1000 - now) / 1000));
    const retryAfter = headers.get("retry-after");
    if (/^\d+$/.test(retryAfter)) waits.push(Number(retryAfter));
    else if (retryAfter && Number.isFinite(Date.parse(retryAfter))) waits.push(Math.ceil((Date.parse(retryAfter) - now) / 1000));
    if (!waits.length) throw new Error("GitHub rate limited settings read without a usable reset/retry-after header; refusing to pass.");
    const seconds = Math.max(1, ...waits);
    if (waitedSeconds + seconds > maxWaitSeconds || now + seconds * 1000 + 30_000 > deadline) {
      const error = new Error(`GitHub API rate limit, not a test failure: wait cap exceeded (${maxWaitSeconds}s total; ${waitedSeconds}s already waited, ${seconds}s requested); settings were not verified.`);
      error.rateLimited = true;
      throw error;
    }
    console.log(`Required-check settings: rate limited, waiting ${seconds}s until reset`);
    const sleep = spawnSync("sleep", [String(seconds)], { timeout: (seconds + 5) * 1000 });
    if (sleep.status !== 0) throw new Error("Rate limit wait failed; settings were not verified.");
    waitedSeconds += seconds;
  }
}

try {
  if (!needsVerification()) {
    console.log("Required-check settings: PR has no CI-policy changes; skipping settings API reads.");
  } else {
    const repo = process.env.REPO;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Missing or invalid REPO.");
    const repository = readSettings(`repos/${repo}`);
    if (repository.default_branch !== "production") throw new Error("Repository default branch must be production.");

    const rulesets = readSettings(`repos/${repo}/rulesets?per_page=100`);
    const matches = rulesets.filter((ruleset) => ruleset.name === "production-required-checks" && ruleset.enforcement === "active");
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id) || matches[0].id <= 0) {
      throw new Error("Expected one active production-required-checks ruleset.");
    }
    const ruleset = readSettings(`repos/${repo}/rulesets/${matches[0].id}`);
    if (ruleset.target !== "branch" ||
        !ruleset.conditions.ref_name.include.includes("refs/heads/production") ||
        ruleset.conditions.ref_name.exclude.includes("refs/heads/production")) {
      throw new Error("The required-check ruleset does not protect production.");
    }
    const expected = [
      "app-smoke", "ci-tests", "ai-review", "claude-review", "feature-flag-gate",
      "next-public-secrets", "pr-title", "secret-scan", "browser-smoke", "premerge-evidence",
    ].sort();
    const actual = [...new Set(ruleset.rules
      .filter((rule) => rule.type === "required_status_checks")
      .flatMap((rule) => rule.parameters.required_status_checks.map((check) => check.context)))].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Live required checks do not match docs/ci-policy.yml.");
    }
    console.log("Required-check settings verified: default branch, production protection, and exact required contexts.");
  }
} catch (error) {
  console.error(`::error::${error.message}`);
  if (error.rateLimited && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### GitHub API rate limit, not a test failure\n\n${error.message}\n\nRe-run this job after the limit resets.\n`);
  }
  process.exitCode = 1;
}
