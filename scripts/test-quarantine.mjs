import { readFileSync } from "node:fs";

const SUBTEST_FAILED = /^\d+ subtests? failed$/;
const ADDED_ON = /^\d{4}-\d{2}-\d{2}$/;

export function loadQuarantine(file) {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!parsed || !Array.isArray(parsed.tests)) {
    throw new Error(`${file} must contain a tests array`);
  }
  return parsed.tests;
}

export function evidenceUrlProblem(link) {
  if (typeof link !== "string") return "evidence link must be a string";
  let url;
  try {
    url = new URL(link);
  } catch {
    return "evidence link must be a URL";
  }
  if (url.protocol !== "https:") return "evidence link must use https";
  if (url.hostname !== "github.com") return "evidence link host must be github.com";
  const run = /^\/[^/]+\/[^/]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?\/?$/.test(url.pathname);
  const commit = /^\/[^/]+\/[^/]+\/commit\/[0-9a-f]{7,40}\/?$/.test(url.pathname);
  if (!run && !commit) return "evidence link must be an actions run or commit URL";
  return null;
}

export function entryProblems(entry) {
  const problems = [];
  if (!entry || typeof entry.test !== "string" || entry.test.trim() === "") problems.push("missing test");
  if (!entry || typeof entry.owner !== "string" || entry.owner.trim() === "") problems.push("missing owner");
  if (!entry || typeof entry.ticket !== "string" || !entry.ticket.startsWith("https://")) {
    problems.push("missing ticket");
  }
  if (!entry || !Array.isArray(entry.evidence) || entry.evidence.length < 2) {
    problems.push("need at least two evidence links");
  } else {
    for (const link of entry.evidence) {
      const problem = evidenceUrlProblem(link);
      if (problem) problems.push(`${link}: ${problem}`);
    }
  }
  if (!entry || typeof entry.reason !== "string" || entry.reason.trim().length < 10) problems.push("missing reason");
  if (!entry || typeof entry.addedAt !== "string" || !ADDED_ON.test(entry.addedAt)) problems.push("missing addedAt");
  return problems;
}

export function quarantineEntryFor(failure, entries) {
  const file = String(failure.file || "").replaceAll("\\", "/");
  for (const entry of entries) {
    const key = entry.test;
    if (failure.name === key) return entry;
    if (key.includes("/") && (file === key || file.endsWith(`/${key}`) || file.endsWith(key))) return entry;
  }
  return null;
}

function isSubtestContainer(failure) {
  return SUBTEST_FAILED.test(failure.error || "");
}

export function checkOutcome(status, failures, entries) {
  if (!status) return { failCheck: false, blocking: [], quarantined: [] };
  const leaves = failures.filter((failure) => !isSubtestContainer(failure));
  const quarantined = leaves.filter((failure) => quarantineEntryFor(failure, entries));
  if (leaves.length === 0) return { failCheck: true, blocking: failures.slice(), quarantined: [] };
  const blocking = leaves.filter((failure) => !quarantineEntryFor(failure, entries));
  return { failCheck: blocking.length > 0, blocking, quarantined };
}

const NOT_OK = /^(\s*)not ok \d+ - (.*)$/;
const SPEC_FAIL = /^(\s*)✖ (?!failing tests\b)(.+?) \((?:\d+(?:\.\d+)?)m?s\)$/;
const TEST_AT = /^\s*test at (\S+):\d+:\d+\s*$/;
const ERROR_LINE = /^\s*error:\s*(.*)$/;
const LOCATION_LINE = /^\s*location:\s*'([^']+)'/;

function unquoteYaml(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function createTapParser() {
  let carry = "";
  let current = null;
  let follow = 0;
  let pendingFile = null;
  const failures = [];

  function closeCurrent() {
    if (!current) return;
    failures.push(current);
    current = null;
    follow = 0;
  }

  function consume(line) {
    const located = line.match(TEST_AT);
    if (located) pendingFile = located[1];
    const started = line.match(NOT_OK) || line.match(SPEC_FAIL);
    if (started) {
      closeCurrent();
      current = { name: started[2].trim(), file: pendingFile, error: null, indent: started[1].length };
      pendingFile = null;
      follow = 0;
      return;
    }
    if (!current) return;
    follow += 1;
    if (follow > 40) {
      closeCurrent();
      return;
    }
    if (!current.error) {
      const error = line.match(ERROR_LINE);
      if (error && error[1].trim() !== "|-" && error[1].trim() !== "|") {
        current.error = unquoteYaml(error[1]);
      }
    }
    if (!current.file) {
      const location = line.match(LOCATION_LINE);
      if (location) current.file = location[1].split(":").slice(0, -2).join(":") || location[1];
    }
  }

  return {
    push(text) {
      carry += text;
      const lines = carry.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) consume(line);
    },
    finish() {
      if (carry) consume(carry);
      closeCurrent();
      return failures;
    },
  };
}

export function parseTapFailures(text) {
  const parser = createTapParser();
  parser.push(text);
  return parser.finish();
}
