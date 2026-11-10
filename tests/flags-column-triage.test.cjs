const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const cases = require("./fixtures/flags-column-triage/cases.json");
const { key, flagUrl, flag, task, fixture } = require("./fixtures/flags-column-triage/fixture.cjs");
const load = () => import("../scripts/flags/triage-flags-column.mjs");

test("HTPR-7789 reports the missing label and clickable card link without writing to the board", async () => {
  const { triageFlagsColumn } = await load();
  const f = fixture();
  const report = triageFlagsColumn(f);
  assert.equal(report.clean, false);
  assert.equal(report.owner, "Mini Boss CEO");
  assert.deepEqual(report.tickets[0].issues, ["Expected exactly one state label: flag:owner-only", `Missing flag card link: ${flagUrl}`]);
  assert.deepEqual(f.writes(), []);
});

test("the fixed vocabulary follows live modes, never historical audience prose", async () => {
  const { inspectTicket } = await load();
  for (const [mode, label] of Object.entries({ EVERYONE: "flag:everyone", OWNER_ONLY: "flag:owner-only", OWNER_AND_QA: "flag:qa-only", OFF: "flag:off" })) {
    assert.equal(inspectTicket(task(), [flag({ mode })], []).label, label);
  }
});

test("repair removes stale state labels, keeps unrelated labels and content, and is idempotent", async () => {
  const { triageFlagsColumn } = await load();
  const description = `<html><body><p>Behind ${key}. Original content stays.</p></body></html>`;
  const f = fixture({ tasks: [task({ description, labels: [{ name: "Bug" }, { name: "flag:off" }, { name: "flag:everyone" }] })] });
  assert.equal(triageFlagsColumn({ ...f, apply: true }).clean, true);
  assert.deepEqual(f.state.tasks[0].labels, [{ name: "Bug" }, { name: "flag:owner-only" }]);
  const writes = f.writes().length;
  assert.equal(triageFlagsColumn({ ...f, apply: true }).clean, true);
  assert.equal(f.writes().length, writes);
});

test("a registry ticket with no declaration still repairs the link and keeps ask in the report", async () => {
  const { triageFlagsColumn } = await load();
  const f = fixture({ tasks: [task({ ticketNumber: "HTPR-7511", description: "<p>Existing description.</p>" })] });
  const report = triageFlagsColumn({ ...f, apply: true });
  assert.equal(report.clean, true);
  assert.equal(report.tickets[0].ask, true);
  assert.ok(f.state.tasks[0].description.includes("/admin/flags/"));
  assert.deepEqual(f.writes().filter(([, args]) => args[0] === "comment"), []);
});

test("missing, unknown and ambiguous flags remain unresolved, never get a guessed label", async () => {
  const { triageFlagsColumn } = await load();
  for (const description of cases.ambiguousDescriptions) {
    const f = fixture({ tasks: [task({ description })], flags: [flag(), flag({ key: "htpr-2-other", ticketId: "HTPR-2" })] });
    const report = triageFlagsColumn({ ...f, apply: true });
    assert.equal(report.clean, false);
    assert.equal(report.tickets[0].label, null);
    assert.equal(report.tickets[0].ask, true);
    assert.deepEqual(f.writes().filter(([, args]) => args[0] === "comment"), []);
  }
});

test("clean data is a positive control for missing-link and state-label checks", async () => {
  const { triageFlagsColumn } = await load();
  const f = fixture({ tasks: [task({ description: `<p><a href='${flagUrl}'>${key}</a></p>`, labels: [{ name: "Bug" }, { name: "flag:owner-only" }] })] });
  assert.equal(triageFlagsColumn(f).clean, true);
});

test("a bare card URL does not count as a clickable link; relative card anchors do", async () => {
  const { inspectTicket } = await load();
  assert.equal(inspectTicket(task({ description: `<p>${flagUrl}</p>` }), [flag()], []).addLink, true);
  assert.equal(inspectTicket(task({ description: `<p><a href='/admin/flags/${key}'>Flag</a></p>` }), [flag()], []).addLink, false);
});

test("missing columns, incomplete pages, repeated cursors and invalid flag reads fail closed before repair", async () => {
  const { triageFlagsColumn } = await load();
  const hardening = [
    [(binary, args) => binary === "hypertask" && args[0] === "sections" ? { success: true, sections: [] } : undefined, /no Flag: columns/],
    [(binary, args) => binary === "hypertask" && args[0] === "sections" ? { success: true, sections: [{ section_title: "No Flag" }] } : undefined, /no Flag: columns/],
    [(binary) => binary.endsWith("/ht-flag") ? { flags: [{ key, mode: "NEW_MODE" }] } : undefined, /Invalid live flag/],
    [(binary, args) => binary === "hypertask" && args[0] === "tasks" && args[1] === "list" ? { success: true, tasks: [task()], total: 2 } : undefined, /Incomplete tasks/],
    [(binary, args) => binary === "hypertask" && args[0] === "comment" ? { success: true, comments: [], has_more: true } : undefined, /Incomplete comments/],
    [(binary, args) => binary === "hypertask" && args[0] === "tasks" && args[1] === "list" ? { success: true, tasks: [task()], nextCursor: "same" } : undefined, /Repeated tasks cursor/],
  ];
  for (const [intercept, expected] of hardening) {
    const f = fixture({ intercept });
    assert.throws(() => triageFlagsColumn({ ...f, apply: true }), expected);
  }
});

test("repair rereads the ticket and skips one that has left flag columns", async () => {
  const { triageFlagsColumn } = await load();
  const f = fixture({ intercept(binary, args) {
    if (binary === "hypertask" && args[0] === "tasks" && args[1] === "get") return { success: true, tasks: [task({ section: "Done" })] };
  } });
  assert.deepEqual(triageFlagsColumn({ ...f, apply: true }).tickets, []);
});

test("comment pagination trusts total when the final page keeps has_more", async () => {
  const { triageFlagsColumn } = await load();
  const f = fixture({ intercept(binary, args) {
    if (binary === "hypertask" && args[0] === "comment") return { success: true, comments: [{ text: "Earlier comment" }], total: 1, has_more: true };
  } });
  assert.doesNotThrow(() => triageFlagsColumn(f));
});

test("the Mini Boss CEO timer schedules four read-only reports daily without embedding credentials", () => {
  const read = (suffix) => readFileSync(path.join(__dirname, `../scripts/flags/triage-flags-column.${suffix}`), "utf8");
  assert.match(read("timer"), /^OnCalendar=\*-\*-\* 00\/6:00:00$/m);
  assert.match(read("service"), /^SuccessExitStatus=2$/m);
  assert.doesNotMatch(read("service"), /--apply|Bearer|TOKEN=/);
});
