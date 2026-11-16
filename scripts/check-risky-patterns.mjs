import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BASELINE_PATH = "scripts/risky-pattern-baseline.json";
export const EXCEPTIONS_PATH = "scripts/risky-pattern-exceptions.json";
export const TICKET_URL = /^https:\/\/app\.hypertask\.ai\/detail\/project-\d+\/\d+$/;

const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

export const PATTERNS = {
  effectHooks: {
    label: "Effect hooks",
    rightWay: "Handle the change in the event that caused it, or compute the value while rendering. useEffect is only for talking to a system outside React.",
    source: "useEffect\\(",
  },
  quickFixTimers: {
    label: "Quick-fix timers",
    rightWay: "Wait for the real event or the promise. setTimeout is not a way to hope the screen is ready.",
    source: "setTimeout\\(",
  },
  typeEscapes: {
    label: "Type escapes",
    rightWay: "Name the real type. as any only hides the mistake from the compiler.",
    source: "\\bas any\\b",
  },
  lintSilences: {
    label: "Lint silences",
    rightWay: "Fix the finding. An eslint-disable comment leaves the bad line in place.",
    source: "eslint-disable",
  },
};

const KEYS = Object.keys(PATTERNS);

function occurrences(text, source) {
  return text.match(new RegExp(source, "g"))?.length ?? 0;
}

export function emptyCounts() {
  return Object.fromEntries(KEYS.map((key) => [key, 0]));
}

export function countText(text) {
  return Object.fromEntries(KEYS.map((key) => [key, occurrences(text, PATTERNS[key].source)]));
}

export function addCounts(total, extra) {
  const next = { ...total };
  for (const key of KEYS) next[key] += extra[key] ?? 0;
  return next;
}

export function countTree(root) {
  const files = execFileSync("git", ["ls-files", "-z", "src"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((file) => SOURCE.test(file));
  return files.reduce(
    (total, file) => addCounts(total, countText(readFileSync(join(root, file), "utf8"))),
    emptyCounts(),
  );
}

function exceptionShape(index, entry) {
  const problems = [];
  if (!entry || typeof entry !== "object" || !Object.hasOwn(PATTERNS, entry.pattern)) {
    problems.push(`pattern must be one of ${KEYS.join(", ")}`);
  }
  if (typeof entry?.ticket !== "string" || !TICKET_URL.test(entry.ticket)) {
    problems.push("ticket must be a full https://app.hypertask.ai/detail/project-<board>/<number> link");
  }
  if (typeof entry?.reason !== "string" || entry.reason.trim().length < 12) {
    problems.push("reason must say why no other shape works");
  }
  return problems.length ? `Exception ${index + 1}: ${problems.join("; ")}.` : "";
}

export function parseExceptions(value) {
  if (!Array.isArray(value)) {
    return { entries: [], errors: ["scripts/risky-pattern-exceptions.json must be a JSON array."] };
  }
  const entries = [];
  const errors = [];
  value.forEach((entry, index) => {
    const problem = exceptionShape(index, entry);
    if (problem) errors.push(problem);
    else entries.push({ pattern: entry.pattern, ticket: entry.ticket, reason: entry.reason.trim() });
  });
  return { entries, errors };
}

function tally(entries) {
  const extra = emptyCounts();
  for (const entry of entries) extra[entry.pattern] += 1;
  return extra;
}

function exceptionPath(key) {
  return `An approved exception is one object in scripts/risky-pattern-exceptions.json with pattern "${key}", a reason, and ticket set to a full https://app.hypertask.ai/detail/project-<board>/<number> link. Do not raise scripts/risky-pattern-baseline.json.`;
}

export function judge({ counts, baseBaseline, headBaseline, baseExceptions, headExceptions }) {
  const failures = [];
  const parsedHead = parseExceptions(headExceptions);
  failures.push(...parsedHead.errors);
  const parsedBase = parseExceptions(Array.isArray(baseExceptions) ? baseExceptions : []);
  const baseTally = tally(parsedBase.errors.length ? [] : parsedBase.entries);
  const headTally = tally(parsedHead.errors.length ? [] : parsedHead.entries);
  const establishing = baseBaseline == null;
  for (const key of KEYS) {
    const pattern = PATTERNS[key];
    const count = counts?.[key];
    const headCap = headBaseline?.[key];
    if (!Number.isInteger(count) || count < 0) {
      failures.push(`${pattern.label} count is missing.`);
      continue;
    }
    if (!Number.isInteger(headCap) || headCap < 0) {
      failures.push(`${pattern.label} baseline must be a whole number.`);
      continue;
    }
    if (establishing) {
      if (count !== headCap) {
        failures.push(`${pattern.label} baseline is ${headCap} and the code has ${count}. Set scripts/risky-pattern-baseline.json to the current count. Do not leave room for new copies.`);
      }
      continue;
    }
    const baseCap = baseBaseline[key];
    if (!Number.isInteger(baseCap) || baseCap < 0) {
      failures.push(`${pattern.label} is missing from the production baseline.`);
      continue;
    }
    if (headCap > baseCap) {
      failures.push(`${pattern.label} baseline went from ${baseCap} to ${headCap}. Do not raise scripts/risky-pattern-baseline.json. ${exceptionPath(key)}`);
    }
    const added = Math.max(0, headTally[key] - baseTally[key]);
    const limit = baseCap + added;
    if (count > limit) {
      failures.push(`${pattern.label} went from ${limit} allowed to ${count} in the code. ${pattern.rightWay} ${exceptionPath(key)}`);
    }
  }
  return failures;
}

export function loadJson(root, rel) {
  try {
    return JSON.parse(readFileSync(join(root, rel), "utf8"));
  } catch {
    throw new Error(`${rel} is not readable JSON.`);
  }
}

function gitShow(root, spec) {
  try {
    return execFileSync("git", ["show", spec], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

export function checkRepository(root, options = {}) {
  const counts = options.counts ?? countTree(root);
  const headBaseline = options.headBaseline ?? loadJson(root, BASELINE_PATH);
  const headExceptions = options.headExceptions ?? loadJson(root, EXCEPTIONS_PATH);
  const baseBaseline = options.baseBaseline === undefined
    ? (() => {
      const text = gitShow(root, `origin/production:${BASELINE_PATH}`);
      return text == null ? null : JSON.parse(text);
    })()
    : options.baseBaseline;
  const baseExceptions = options.baseExceptions === undefined
    ? (() => {
      const text = gitShow(root, `origin/production:${EXCEPTIONS_PATH}`);
      return text == null ? [] : JSON.parse(text);
    })()
    : options.baseExceptions;
  return judge({ counts, baseBaseline, headBaseline, baseExceptions, headExceptions });
}

function main() {
  const root = process.cwd();
  const counts = countTree(root);
  const failures = checkRepository(root, { counts });
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exit(1);
  }
  console.log(`risky patterns ok: ${KEYS.map((key) => `${key}=${counts[key]}`).join(" ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
