#!/usr/bin/env node

import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(
  fs.readFileSync(
    path.join(root, "config/app-project-performance-baseline.json"),
    "utf8",
  ),
);

const args = process.argv.slice(2);
const changedFilesFlag = args.indexOf("--changed-files");
const evidenceFileFlag = args.indexOf("--evidence-file");
const evidencePathFlag = args.indexOf("--evidence-path");
const artifactDirectoryFlag = args.indexOf("--artifact-directory");
const expectedCommitFlag = args.indexOf("--expected-commit");
if (
  changedFilesFlag === -1 ||
  !args[changedFilesFlag + 1] ||
  evidenceFileFlag === -1 ||
  !args[evidenceFileFlag + 1] ||
  evidencePathFlag === -1 ||
  !args[evidencePathFlag + 1] ||
  artifactDirectoryFlag === -1 ||
  !args[artifactDirectoryFlag + 1] ||
  expectedCommitFlag === -1 ||
  !args[expectedCommitFlag + 1]
) {
  console.error(
    "Usage: node scripts/check-speed-pr-evidence.mjs --changed-files <file-list> --evidence-file <evidence.json> --evidence-path <relative-path> --artifact-directory <directory> --expected-commit <sha>",
  );
  process.exit(2);
}

const changedFilesPath = path.resolve(args[changedFilesFlag + 1]);
const changedFiles = fs
  .readFileSync(changedFilesPath, "utf8")
  .split(/\r?\n/u)
  .map((entry) => entry.trim())
  .filter(Boolean);
const evidenceFiles = changedFiles.filter((entry) =>
  /^performance\/evidence\/[A-Za-z0-9._-]+\.json$/u.test(entry),
);

if (evidenceFiles.length !== 1) {
  console.error(
    `Speed PRs must add or update exactly one performance/evidence/*.json file; found ${evidenceFiles.length}.`,
  );
  process.exit(1);
}
if (args[evidencePathFlag + 1] !== evidenceFiles[0]) {
  console.error(
    `The supplied evidence path must match ${evidenceFiles[0]}; received ${args[evidencePathFlag + 1]}.`,
  );
  process.exit(1);
}

const evidencePath = path.resolve(args[evidenceFileFlag + 1]);
if (!fs.existsSync(evidencePath)) {
  console.error(`Speed evidence file does not exist: ${evidencePath}`);
  process.exit(1);
}
const artifactDirectory = path.resolve(args[artifactDirectoryFlag + 1]);
if (!fs.statSync(artifactDirectory, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`Speed artifact directory does not exist: ${artifactDirectory}`);
  process.exit(1);
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const fail = (message) => {
  throw new Error(`${evidenceFiles[0]}: ${message}`);
};
const requireString = (value, name) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${name} must be a non-empty string.`);
  }
};
const requireFiniteNonNegative = (value, name) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(`${name} must be a finite, non-negative number.`);
  }
};
const requireCanonicalUtcTimestamp = (value, name) => {
  requireString(value, name);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    fail(`${name} must be a valid canonical UTC timestamp with milliseconds.`);
  }
};
const requireHttpsUrl = (value, name) => {
  requireString(value, name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") {
    fail(`${name} must be a valid HTTPS URL.`);
  }
};

if (evidence.schemaVersion !== 1) fail("schemaVersion must equal 1.");
requireString(evidence.ticketUrl, "ticketUrl");
if (!/^https:\/\/app\.hypertask\.ai\/detail\/project-15\/\d+$/u.test(evidence.ticketUrl)) {
  fail("ticketUrl must be a full Board 15 task URL.");
}
requireCanonicalUtcTimestamp(evidence.capturedAt, "capturedAt");

const protectedPolicyPaths = [
  /^\.github\/workflows\/(?:automerge|ci-build|speed-evidence)\.yml$/u,
  /^config\/app-project-performance-baseline\.json$/u,
  /^scripts\/check-speed-pr-evidence\.mjs$/u,
];
const policyChanges = changedFiles.filter((entry) =>
  protectedPolicyPaths.some((pattern) => pattern.test(entry)),
);
if (policyChanges.length > 0) {
  fail(
    `speed policy files cannot change in a [SPEED] PR; submit them in a separately reviewed CI PR: ${policyChanges.join(", ")}`,
  );
}

if (evidence.productBehaviorChanged !== true) {
  fail("productBehaviorChanged must equal true for every [SPEED] PR.");
}

requireString(evidence.measuredCommit, "measuredCommit");
if (!/^[0-9a-f]{40}$/u.test(evidence.measuredCommit)) {
  fail("measuredCommit must be a full 40-character Git commit SHA.");
}
const expectedCommit = args[expectedCommitFlag + 1];
if (!/^[0-9a-f]{40}$/u.test(expectedCommit)) {
  fail("expected commit must be a full 40-character Git commit SHA.");
}
if (evidence.measuredCommit !== expectedCommit) {
  fail(
    `measuredCommit must match the exact PR head ${expectedCommit}; received ${evidence.measuredCommit}.`,
  );
}

if (evidence.deviceClass !== "mobile") {
  fail('deviceClass must equal "mobile".');
}
const expectedDevice = baseline.devices.mobile;
if (
  evidence.profile?.name !== "Pixel 7" ||
  evidence.profile?.viewport !== expectedDevice.viewport ||
  evidence.profile?.cpuThrottle !== expectedDevice.cpuThrottle ||
  evidence.profile?.cache !== "cold"
) {
  fail(
    `profile must be Pixel 7, ${expectedDevice.viewport}, ${expectedDevice.cpuThrottle}x CPU, cold cache.`,
  );
}

const minimumRuns = baseline.releaseGate.minimumRuns;
if ("baselineRuns" in evidence) {
  fail("baselineRuns must be omitted because the checker uses trusted staging baselines.");
}
if (!Array.isArray(evidence.candidateRuns) || evidence.candidateRuns.length !== minimumRuns) {
  fail(`candidateRuns must contain exactly ${minimumRuns} runs.`);
}

const metricDefinitions = [
  {
    name: "totalBlockingTimeMs",
    aggregate: "median",
    trustedBaseline: baseline.releaseGate.baselineTotalBlockingTimeMs,
  },
  {
    name: "longestTaskMs",
    aggregate: "maximum",
    trustedBaseline: baseline.releaseGate.baselineLongestTaskMs,
  },
  {
    name: "scriptCount",
    aggregate: "median",
    trustedBaseline: expectedDevice.scriptCount,
  },
  {
    name: "scriptDecodedBytes",
    aggregate: "median",
    trustedBaseline: expectedDevice.scriptDecodedBytes,
  },
  {
    name: "apiRequestCount",
    aggregate: "median",
    trustedBaseline: expectedDevice.apiRequestCount,
  },
  {
    name: "apiDecodedBytes",
    aggregate: "median",
    trustedBaseline: expectedDevice.apiDecodedBytes,
  },
];
const countMetrics = new Set(["scriptCount", "apiRequestCount"]);
const runIds = new Set();
const runTimestamps = new Set();
const artifactUrls = new Set();
const artifactDigests = new Set();

evidence.candidateRuns.forEach((run, runIndex) => {
  const prefix = `candidateRuns[${runIndex}]`;
  requireString(run?.runId, `${prefix}.runId`);
  if (!/^[A-Za-z0-9._-]+$/u.test(run.runId)) {
    fail(`${prefix}.runId may contain only letters, numbers, dots, underscores, and hyphens.`);
  }
  requireCanonicalUtcTimestamp(run?.capturedAt, `${prefix}.capturedAt`);
  if (Date.parse(run.capturedAt) > Date.parse(evidence.capturedAt)) {
    fail(`${prefix}.capturedAt must not be later than the evidence capturedAt value.`);
  }
  requireHttpsUrl(run?.artifactUrl, `${prefix}.artifactUrl`);
  if (
    !/^https:\/\/api\.github\.com\/repos\/valentinyeo\/hypertasks\/issues\/comments\/[1-9][0-9]*$/u.test(
      run.artifactUrl,
    )
  ) {
    fail(`${prefix}.artifactUrl must reference an owner-authored Hypertask GitHub comment.`);
  }
  if (!/^[0-9a-f]{64}$/u.test(run?.artifactSha256)) {
    fail(`${prefix}.artifactSha256 must be a lowercase SHA-256 digest.`);
  }
  runIds.add(run.runId);
  runTimestamps.add(run.capturedAt);
  artifactUrls.add(run.artifactUrl);
  artifactDigests.add(run.artifactSha256);

  const artifactPath = path.join(artifactDirectory, `${runIndex}.json`);
  if (!fs.existsSync(artifactPath)) {
    fail(`${prefix} trusted artifact is missing.`);
  }
  const artifactBuffer = fs.readFileSync(artifactPath);
  const actualDigest = createHash("sha256").update(artifactBuffer).digest("hex");
  if (actualDigest !== run.artifactSha256) {
    fail(`${prefix}.artifactSha256 does not match the trusted artifact content.`);
  }
  let artifact;
  try {
    artifact = JSON.parse(artifactBuffer.toString("utf8"));
  } catch {
    fail(`${prefix} trusted artifact must contain valid JSON.`);
  }
  if (
    artifact.schemaVersion !== 1 ||
    artifact.measuredCommit !== expectedCommit ||
    artifact.runId !== run.runId ||
    artifact.capturedAt !== run.capturedAt ||
    artifact.deviceClass !== evidence.deviceClass ||
    artifact.profile?.name !== evidence.profile.name ||
    artifact.profile?.viewport !== evidence.profile.viewport ||
    artifact.profile?.cpuThrottle !== evidence.profile.cpuThrottle ||
    artifact.profile?.cache !== evidence.profile.cache
  ) {
    fail(`${prefix} does not match its trusted artifact identity and profile.`);
  }
  metricDefinitions.forEach(({ name }) => {
    const metricName = `candidateRuns[${runIndex}].${name}`;
    requireFiniteNonNegative(run?.[name], metricName);
    if (countMetrics.has(name) && !Number.isInteger(run[name])) {
      fail(`${metricName} must be an integer.`);
    }
    if (artifact.metrics?.[name] !== run[name]) {
      fail(`${metricName} does not match the trusted artifact.`);
    }
  });
});
if (
  runIds.size !== minimumRuns ||
  runTimestamps.size !== minimumRuns ||
  artifactUrls.size !== minimumRuns ||
  artifactDigests.size !== minimumRuns
) {
  fail(
    "candidateRuns must have distinct runId, capturedAt, artifactUrl, and artifactSha256 values.",
  );
}

const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
};
const aggregate = (runs, metric, method) => {
  const values = runs.map((run) => run[metric]);
  return method === "maximum" ? Math.max(...values) : median(values);
};

const rows = metricDefinitions.map(({ name, aggregate: method, trustedBaseline }) => {
  const before = trustedBaseline;
  const after = aggregate(evidence.candidateRuns, name, method);
  const changePercent = before === 0 ? (after === 0 ? 0 : Infinity) : ((after - before) / before) * 100;
  return {
    metric: name,
    aggregate: method,
    before,
    after,
    changePercent: Number.isFinite(changePercent)
      ? Number(changePercent.toFixed(2))
      : "Infinity",
    status:
      changePercent > baseline.regressionPercent ? "regression" : "pass",
  };
});

console.table(rows);
const totalBlockingTime = rows.find(
  (row) => row.metric === "totalBlockingTimeMs",
).after;
const longestTask = rows.find((row) => row.metric === "longestTaskMs").after;
console.log(
  `Targets: median TBT <= ${baseline.releaseGate.totalBlockingTimeTargetMs} ms (${totalBlockingTime} ms); longest task <= ${baseline.releaseGate.longTaskTargetMs} ms (${longestTask} ms).`,
);

const safetyChecks = [
  "twoAuthenticatedSessions",
  "oneActionOneNavigation",
  "oneVisibleLoad",
  "crossUserUpdateWithoutReload",
  "reconnectWithoutReload",
  "tabWakeWithoutReload",
  "rapidViewSwitchStable",
  "eventDuringNavigationFresh",
];
for (const check of safetyChecks) {
  if (evidence.realtimeQa?.[check] !== true) {
    fail(`realtimeQa.${check} must be true.`);
  }
}
requireHttpsUrl(evidence.realtimeQa?.proofUrl, "realtimeQa.proofUrl");
requireString(evidence.realtimeQa?.notes, "realtimeQa.notes");

if (totalBlockingTime > baseline.releaseGate.totalBlockingTimeTargetMs) {
  fail(
    `median total blocking time exceeds the ${baseline.releaseGate.totalBlockingTimeTargetMs} ms release budget.`,
  );
}
if (longestTask > baseline.releaseGate.longTaskTargetMs) {
  fail(
    `the longest task exceeds the ${baseline.releaseGate.longTaskTargetMs} ms release budget.`,
  );
}
if (rows.some((row) => row.status === "regression")) {
  fail(`one or more metrics regressed by more than ${baseline.regressionPercent}%.`);
}

console.log("Speed evidence gate passed.");
