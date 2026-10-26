const TAP_FAILURE = /^\s*not ok \d+ - (.+)$/;
const SPEC_FAILURE = /^\s*✖ (?!failing tests\b)(.+?) \((?:\d+(?:\.\d+)?)m?s\)$/;
const TEST_AT = /^\s*test at ((?:tests|e2e)\/\S+?):\d+:\d+\s*$/;
const PLAYWRIGHT_HEAD = /^\s*\d+ (failed|flaky)\s*$/;
const PLAYWRIGHT_ITEM = /^\s*\[[^\]]+\]\s+›\s+(\S+):\d+:\d+\s+›\s+(.+?)\s*$/;
const ANSI = /\u001b\[[0-9;]*m/g;

const INFRA_RULES = [
  { id: "rate-limit", pattern: /API rate limit exceeded|Secondary rate limit|rate limit wait cap exceeded/i },
  { id: "cancelled", pattern: /The operation was canceled|Canceling since a higher priority waiting request/i },
  { id: "runner-shutdown", pattern: /The runner has received a shutdown signal|Lost communication with the server/i },
  { id: "disk", pattern: /No space left on device/i },
  { id: "font-fetch", pattern: /An error occurred in `next\/font`|nextFontGoogleFontLoader/ },
];

export function actionsLogMessage(line) {
  const stripped = line.replace(ANSI, "").replace(/[─]+$/u, "");
  const parts = stripped.split("\t");
  if (parts.length >= 3 && /^\d{4}-\d{2}-\d{2}T/.test(parts[2])) {
    return {
      step: parts[1],
      message: parts[2].replace(/^\S+\s/, ""),
    };
  }
  const timed = stripped.match(/^\d{4}-\d{2}-\d{2}T\S+Z\s(.*)$/);
  if (timed) return { step: "", message: timed[1] };
  return { step: "", message: stripped };
}

function quotedAssertion(text) {
  const actual = text.match(/actual:\s*(\[[^\]]*\])/);
  const expected = text.match(/expected:\s*(\[[^\]]*\])/);
  if (!actual || !expected) return "";
  return `actual: ${actual[1]}, expected: ${expected[1]}`;
}

function nearbyEvidence(messages, index) {
  const window = messages.slice(index, index + 40);
  const assertion = quotedAssertion(window.join("\n"));
  if (assertion) return assertion;
  const element = window.find((line) => /element\(s\) not found/.test(line));
  const locator = window.find((line) => /^\s*Locator:/.test(line));
  if (locator && element) return `${locator.trim()}\n${element.trim()}`;
  return element ? element.trim() : "";
}

export function classifyActionsLog(text) {
  const found = new Map();
  let infra = null;
  let errorLine = null;
  let pendingFile = "";
  let playwrightSection = "";
  const messages = text.split("\n").map((raw) => actionsLogMessage(raw).message);
  const steps = text.split("\n").map((raw) => actionsLogMessage(raw).step);
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const step = steps[index];
    const testAt = message.match(TEST_AT);
    if (testAt) pendingFile = testAt[1];
    const tap = message.match(TAP_FAILURE);
    const spec = message.match(SPEC_FAILURE);
    const testStep = step === "Test" || step === "Test full suite" || step === "UNKNOWN STEP" || step === "";
    if ((tap || spec) && testStep && !message.includes("sed ") && !message.includes("$(sed")) {
      const name = (tap ? tap[1] : spec[1]).trim();
      if (name) {
        const test = pendingFile ? `${pendingFile} › ${name}` : name;
        found.set(test, nearbyEvidence(messages, index) || test);
      }
      pendingFile = "";
    }
    const section = message.match(PLAYWRIGHT_HEAD);
    if (section) playwrightSection = section[1];
    else if (/^\s*\d+ (?:skipped|passed|flaky|failed)\b/.test(message)) playwrightSection = "";
    const item = message.match(PLAYWRIGHT_ITEM);
    if (item && playwrightSection === "failed") {
      const title = item[2].trim();
      const test = `${item[1]} › ${title}`;
      const origin = messages.findIndex((line) => /^\s*\d+\)\s+\[/.test(line) && line.includes(title.slice(0, 80)));
      found.set(test, (origin === -1 ? "" : nearbyEvidence(messages, origin)) || test);
    }
    if (!infra) {
      const rule = INFRA_RULES.find((candidate) => candidate.pattern.test(message));
      if (rule) infra = { id: rule.id, line: message.trim().slice(0, 400) };
    }
    if (!errorLine && message.includes("##[error]") && !message.includes('echo "::error::')) {
      errorLine = message.replace(/^.*##\[error\]/, "##[error]").trim().slice(0, 400);
    }
  }
  for (const name of [...found.keys()]) {
    if ([...found.keys()].some((other) => other !== name && other.endsWith(` › ${name}`))) found.delete(name);
  }
  if (infra?.id === "font-fetch") {
    return { kind: "infra", tests: [], infraId: infra.id, evidenceLine: infra.line, evidenceByTest: new Map() };
  }
  const tests = [...found.keys()].sort();
  if (tests.length > 0) {
    return { kind: "test", tests, evidenceLine: found.get(tests[0]) || tests[0], evidenceByTest: found };
  }
  if (infra) return { kind: "infra", tests: [], infraId: infra.id, evidenceLine: infra.line, evidenceByTest: new Map() };
  if (errorLine) return { kind: "other", tests: [], evidenceLine: errorLine, evidenceByTest: new Map() };
  return { kind: "unknown", tests: [], evidenceLine: "", evidenceByTest: new Map() };
}

export function testFile(name) {
  const match = String(name).match(/((?:tests|e2e)\/\S+?\.(?:cjs|mjs|js|ts|tsx))/);
  return match ? match[1] : "";
}

export function sameAppCode(changedFiles, testNames) {
  const files = testNames.map(testFile).filter(Boolean);
  return changedFiles.every((file) => {
    if (file.startsWith("src/") || file.startsWith("e2e/")) return false;
    if (files.some((testPath) => file === testPath)) return false;
    return true;
  });
}

export function rankFlakes(incidents) {
  const byTest = new Map();
  for (const incident of incidents) {
    const list = byTest.get(incident.test) ?? [];
    list.push(incident);
    byTest.set(incident.test, list);
  }
  const rows = [];
  for (const [test, items] of byTest) {
    const evidence = items.slice().sort((a, b) =>
      a.sha.localeCompare(b.sha) || a.runId - b.runId || a.attempt - b.attempt,
    );
    const shas = [...new Set(evidence.map((item) => item.sha))].sort();
    rows.push({
      test,
      shaCount: shas.length,
      failureCount: evidence.length,
      shas,
      evidence,
    });
  }
  rows.sort((a, b) => b.shaCount - a.shaCount || b.failureCount - a.failureCount || a.test.localeCompare(b.test));
  return rows;
}

export function renderReport({ since, until, runsScanned, retriedRuns, failThenPass, flakyTestJobs = failThenPass, testIncidents, nonTest, sameCode = [] }) {
  const ranked = rankFlakes(testIncidents);
  const proven = ranked.filter((row) => row.shaCount >= 2);
  const sameCodeRanked = rankFlakes(sameCode);
  const lines = [];
  lines.push("# Flaky tests");
  lines.push("");
  lines.push(`Window: workflow runs created ${since} through ${until}, workflow ci-tests.yml.`);
  lines.push(`Runs scanned: ${runsScanned}.`);
  lines.push(`Runs with more than one attempt: ${retriedRuns}.`);
  lines.push(`Same-SHA ci-tests jobs that failed and later passed: ${failThenPass}.`);
  lines.push(`Jobs in that set whose log names a failing test: ${flakyTestJobs}.`);
  lines.push("");
  lines.push("A same-SHA fail-then-pass counts only when the ci-tests job itself failed and a later attempt (or another run of that SHA) of the ci-tests job passed.");
  lines.push("Cancelled workflows and browser-smoke-only failures are not in that count.");
  lines.push("A row below is a test flake only when the failed job log contains a TAP `not ok <n> - <name>` line or a spec-reporter `✖ <name> (…ms)` line from the test step.");
  lines.push("GitHub installation rate-limit reds and next/font Google fetch failures (visual-regression and the browser-smoke build, src/app/login/LoginComponent.tsx) are infra. They are tracked in https://app.hypertask.ai/detail/project-4060/678 and noted on https://app.hypertask.ai/detail/project-4060/668. They are not test flakes and are excluded from the failing-test job count and from the proven, same-SHA test, and same-code sections.");
  lines.push("Rate limit, cancel, runner-shutdown, and font-fetch failures stay in the non-test table with the log line that classified them.");
  lines.push("Quarantine is only for a flake whose cause is not yet found. A known cause is fixed and left off the quarantine list.");
  lines.push("The timer report order row is that case. Its fixture rows use fixed startedAt values, and listReport breaks equal startedAt by id, so it is not quarantined.");
  lines.push("A different SHA is counted only as a same-code flake: the ci-tests or browser-smoke job passed on that SHA, and the diff touches neither src/, e2e/, nor the failing test file.");
  lines.push("");
  lines.push(`## Proven flaky tests (${proven.length})`);
  lines.push("");
  if (proven.length === 0) {
    lines.push("None. No test name failed and later passed on two or more distinct SHAs in this window.");
  } else {
    for (const row of proven) {
      lines.push(...renderRow(row));
    }
  }
  lines.push("");
  lines.push(`## Test failures that also passed on the same SHA (${ranked.length})`);
  lines.push("");
  if (ranked.length === 0) {
    lines.push("None. Every same-SHA ci-tests fail-then-pass in this window was classified from a non-test log line.");
  } else {
    for (const row of ranked) {
      lines.push(...renderRow(row));
    }
  }
  lines.push("");
  lines.push(`## Same-code flakes across SHAs (${sameCodeRanked.length})`);
  lines.push("");
  lines.push("These failed on one SHA and passed on another SHA whose diff does not change app code or the failing test. They are not quarantined unless the same SHA itself failed and later passed at least twice.");
  lines.push("");
  if (sameCodeRanked.length === 0) {
    lines.push("None.");
    lines.push("");
  } else {
    for (const row of sameCodeRanked) {
      lines.push(...renderRow(row));
    }
  }
  lines.push("## Same-SHA failures that are not test flakes");
  lines.push("");
  const groups = new Map();
  for (const item of nonTest) {
    const key = item.infraId || item.kind;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  if (nonTest.length === 0) {
    lines.push("None.");
  } else {
    const keys = [...groups.keys()].sort();
    for (const key of keys) {
      const items = groups.get(key).slice().sort((a, b) => a.sha.localeCompare(b.sha) || a.runId - b.runId);
      lines.push(`### ${key} (${items.length})`);
      lines.push("");
      lines.push("Example log line:");
      lines.push("");
      lines.push("```");
      lines.push(items[0].evidenceLine);
      lines.push("```");
      lines.push("");
      for (const item of items) {
        lines.push(`- \`${item.sha.slice(0, 12)}\` attempt ${item.attempt} ${item.failUrl}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function renderRow(row) {
  const lines = [];
  lines.push(`### ${row.test}`);
  lines.push("");
  lines.push(`Distinct SHAs: ${row.shaCount}. Failing attempts: ${row.failureCount}.`);
  if (row.evidence[0]?.evidenceLine) {
    lines.push("");
    lines.push("Log line:");
    lines.push("");
    lines.push("```");
    lines.push(row.evidence[0].evidenceLine);
    lines.push("```");
  }
  for (const item of row.evidence) {
    lines.push(`- \`${item.sha}\` failed ${item.failUrl} then passed ${item.passUrl}`);
  }
  lines.push("");
  return lines;
}
