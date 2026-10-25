/**
 * Quarantined tests configuration lint.
 * 
 * Ensures every quarantined test has:
 * - owner: GitHub username or team responsible
 * - ticket: issue/PR URL tracking the fix
 * - evidence: at least 2 links proving flakiness (same SHA fail + pass)
 * - reason: explanation of why it's flaky
 * - addedAt: date when quarantined
 * 
 * This prevents quarantine from becoming a dumping ground for broken tests.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const QUARANTINE_FILE = join(__dirname, "..", "config/quarantined-tests.json");
const SCHEMA_FILE = join(__dirname, "..", "config/quarantined-tests.schema.json");

describe("Quarantined tests configuration", () => {
  test("quarantine file exists and is valid JSON", () => {
    const content = readFileSync(QUARANTINE_FILE, "utf8");
    const config = JSON.parse(content);
    assert.ok(config, "Config must be valid JSON");
    assert.ok(Array.isArray(config.tests), "Config must have a tests array");
  });

  test("schema file exists", () => {
    const schema = JSON.parse(readFileSync(SCHEMA_FILE, "utf8"));
    assert.ok(schema, "Schema must be valid JSON");
  });

  test("every quarantined test has required owner", () => {
    const config = JSON.parse(readFileSync(QUARANTINE_FILE, "utf8"));
    for (const entry of config.tests) {
      assert.ok(entry.owner, `Test "${entry.test}" missing owner`);
      assert.ok(
        typeof entry.owner === "string" && entry.owner.length > 0,
        `Test "${entry.test}" owner must be a non-empty string`
      );
    }
  });

  test("every quarantined test has required ticket URL", () => {
    const config = JSON.parse(readFileSync(QUARANTINE_FILE, "utf8"));
    for (const entry of config.tests) {
      assert.ok(entry.ticket, `Test "${entry.test}" missing ticket`);
      assert.ok(
        typeof entry.ticket === "string" && entry.ticket.startsWith("https://"),
        `Test "${entry.test}" ticket must be a URL`
      );
    }
  });

  test("every quarantined test has evidence links (2+)", async () => {
    const { entryProblems } = await import("../scripts/test-quarantine.mjs");
    const config = JSON.parse(readFileSync(QUARANTINE_FILE, "utf8"));
    for (const entry of config.tests) {
      const problems = entryProblems(entry).filter((problem) => problem.startsWith("need at least") || problem.includes("evidence"));
      assert.deepEqual(problems, [], `Test "${entry.test}" evidence: ${problems.join("; ")}`);
    }
  });

  test("every quarantined test has a reason", () => {
    const config = JSON.parse(readFileSync(QUARANTINE_FILE, "utf8"));
    for (const entry of config.tests) {
      assert.ok(entry.reason, `Test "${entry.test}" missing reason`);
      assert.ok(
        typeof entry.reason === "string" && entry.reason.length >= 10,
        `Test "${entry.test}" reason must be at least 10 characters`
      );
    }
  });

  test("every quarantined test has addedAt date", () => {
    const config = JSON.parse(readFileSync(QUARANTINE_FILE, "utf8"));
    for (const entry of config.tests) {
      assert.ok(entry.addedAt, `Test "${entry.test}" missing addedAt`);
      assert.ok(
        /^\d{4}-\d{2}-\d{2}$/.test(entry.addedAt),
        `Test "${entry.test}" addedAt must be YYYY-MM-DD format`
      );
      const date = new Date(entry.addedAt);
      assert.ok(!isNaN(date.getTime()), `Test "${entry.test}" addedAt must be a valid date`);
    }
  });

  test("every quarantined test name is unique", () => {
    const config = JSON.parse(readFileSync(QUARANTINE_FILE, "utf8"));
    const seen = new Set();
    for (const entry of config.tests) {
      assert.ok(
        !seen.has(entry.test),
        `Test "${entry.test}" appears more than once in quarantine list`
      );
      seen.add(entry.test);
    }
  });

  test("quarantine list is not used as a permanent ignore list", () => {
    const config = JSON.parse(readFileSync(QUARANTINE_FILE, "utf8"));
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const old = config.tests.filter((entry) => {
      const added = new Date(entry.addedAt);
      return added < thirtyDaysAgo;
    });

    if (old.length > 0) {
      console.warn(
        `Warning: ${old.length} test(s) have been quarantined for over 30 days:`
      );
      for (const entry of old) {
        console.warn(`  - ${entry.test} (since ${entry.addedAt})`);
      }
      console.warn(
        "Quarantine is temporary. Either fix the test or remove it if it's no longer relevant."
      );
    }

    assert.ok(true, "Age check is advisory only");
  });

  test("every quarantined test is a proven row in the committed report", () => {
    const report = readFileSync(join(__dirname, "..", "docs/flaky-tests-report.md"), "utf8");
    const proven = report.split("## Test failures that also passed on the same SHA")[0];
    const config = JSON.parse(readFileSync(QUARANTINE_FILE, "utf8"));
    assert.ok(proven.includes("## Proven flaky tests"), "report is missing the proven section");
    for (const entry of config.tests) {
      assert.ok(proven.includes(entry.test), `Test "${entry.test}" is not in the proven section`);
      for (const link of entry.evidence) {
        assert.ok(proven.includes(link), `Evidence ${link} is not in the proven section`);
      }
    }
  });
});
