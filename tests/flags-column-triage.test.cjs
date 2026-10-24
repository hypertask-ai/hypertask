const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const load = () => import("../scripts/flags/triage-flags-column.mjs");
const key = "htpr-7511-signup-straight-to-board";
const flagUrl = `https://app.hypertask.ai/admin/flags/${key}`;
const flag = (extra = {}) => ({ key, mode: "OWNER_ONLY", kind: "feature", ticketId: "HTPR-7511", ...extra });
const task = (extra = {}) => ({
  ticketNumber: "HTPR-7549", url: "https://app.hypertask.ai/detail/project-15/7549", projectId: 15,
  section: "Flags", status: "Normal", description: `<p>Behind ${key}, never Everyone.</p>`, labels: [{ name: "Bug" }], ...extra,
});

function fixture({ tasks = [task()], flags = [flag()], comments = {}, intercept } = {}) {
  const calls = [];
  const boardLabels = [];
  const state = { tasks: structuredClone(tasks), flags: structuredClone(flags), comments: structuredClone(comments) };
  const run = (binary, args) => {
    calls.push([binary, args]);
    const overridden = intercept?.(binary, args, state);
    if (overridden !== undefined) return overridden;
    const value = (name) => args[args.indexOf(name) + 1];
    if (binary.endsWith("/ht-flag")) {
      assert.deepEqual(args, ["get"]);
      return structuredClone({ flags: state.flags });
    }
    if (binary === "hypertask") {
      if (args[0] === "sections") return { success: true, sections: [{ section_title: "Flags" }] };
      if (args[0] === "tasks" && args[1] === "list") return structuredClone({ success: true, tasks: state.tasks, total: state.tasks.length });
      if (args[0] === "tasks" && args[1] === "get") return structuredClone({ success: true, tasks: state.tasks.filter((entry) => entry.ticketNumber === args[2]) });
      if (args[0] === "comment") return structuredClone({ success: true, comments: state.comments[args[2]] ?? [] });
      if (args[0] === "labels") return { success: true, labels: boardLabels.map((name) => ({ name })) };
    }
    assert.equal(binary, "vcc", `Unexpected command ${binary} ${args.join(" ")}`);
    if (args[0] === "labels") {
      boardLabels.push(value("--name"));
    } else if (args[0] === "comment") {
      (state.comments[args[2]] ??= []).push({ text: value("--text") });
    } else if (args[0] === "task") {
      const entry = state.tasks.find((item) => item.ticketNumber === args[2]);
      if (args.includes("--remove-labels")) entry.labels = entry.labels.filter((label) => !value("--remove-labels").split(",").includes(label.name));
      if (args.includes("--add-label")) entry.labels.push({ name: value("--add-label") });
      if (args.includes("--description")) entry.description = value("--description");
    } else {
      assert.fail(`Unexpected write ${args.join(" ")}`);
    }
    return { success: true };
  };
  return { run, calls, state, writes: () => calls.filter(([binary]) => binary === "vcc") };
}

test("HTPR-7789 reports the missing label and clickable card link without writing to the board", async () => {
  const { triageFlagsColumn } = await load();
  const f = fixture();
  const report = triageFlagsColumn(f);
  assert.equal(report.clean, false);
  assert.equal(report.owner, "Mini Boss CEO");
  assert.equal(report.tickets[0].ticket, "HTPR-7549");
  assert.equal(report.tickets[0].url, task().url);
  assert.equal(report.tickets[0].label, "flag:owner-only");
  assert.equal(report.tickets[0].flagUrl, flagUrl);
  assert.deepEqual(report.tickets[0].issues, ["Expected exactly one state label: flag:owner-only", `Missing flag card link: ${flagUrl}`]);
  assert.deepEqual(f.writes(), []);
});

test("the fixed vocabulary follows live modes, never historical audience prose", async () => {
  const { inspectTicket } = await load();
  for (const [mode, label] of Object.entries({ EVERYONE: "flag:everyone", OWNER_ONLY: "flag:owner-only", OWNER_AND_QA: "flag:qa-only", OFF: "flag:off" })) {
    const report = inspectTicket(task(), [flag({ mode })], []);
    assert.equal(report.label, label);
  }
  assert.equal(inspectTicket(task(), [flag({ kind: "internal" })], []).label, "flag:internal");
});

test("repair removes stale state labels, keeps unrelated labels and content, and is idempotent", async () => {
  const { triageFlagsColumn } = await load();
  const description = `<html><body><p>Behind ${key}. Original content stays.</p></body></html>`;
  const f = fixture({ tasks: [task({ description, labels: [{ name: "Bug" }, { name: "flag:off" }, { name: "flag:everyone" }] })] });
  assert.equal(triageFlagsColumn({ ...f, apply: true }).clean, true);
  assert.deepEqual(f.state.tasks[0].labels, [{ name: "Bug" }, { name: "flag:owner-only" }]);
  assert.equal(f.state.tasks[0].description, description.replace("</body>", `<p>Flag: <a href="${flagUrl}">${key}</a></p></body>`));
  const updates = f.writes().filter(([, args]) => args[0] === "task");
  assert.equal(updates.length, 1);
  assert.ok(updates[0][1].includes("--remove-labels"));
  assert.ok(updates[0][1].includes("--add-label"));
  assert.ok(!updates[0][1].includes("--labels"));
  const count = f.writes().length;
  assert.equal(triageFlagsColumn({ ...f, apply: true }).clean, true);
  assert.equal(f.writes().length, count);
});

test("a registry ticket with no declaration gets one question and its exact live card", async () => {
  const { triageFlagsColumn, clarification } = await load();
  const f = fixture({ tasks: [task({ ticketNumber: "HTPR-7511", description: "<p>Existing description.</p>" })] });
  assert.equal(triageFlagsColumn({ ...f, apply: true }).clean, true);
  assert.equal(f.state.comments["HTPR-7511"][0].text, `<p>${clarification}</p>`);
  assert.ok(f.state.tasks[0].description.startsWith("<p>Existing description.</p>"));
  assert.ok(f.state.tasks[0].description.includes(flagUrl));
  triageFlagsColumn({ ...f, apply: true });
  assert.equal(f.state.comments["HTPR-7511"].length, 1);
});

test("missing, unknown and ambiguous flags remain unresolved, never get a guessed label", async () => {
  const { triageFlagsColumn, clarification } = await load();
  for (const description of ["<p>No flag declared.</p>", "<p>htpr-9999-removed-flag</p>", `<p>${key} and htpr-2-other</p>`]) {
    const f = fixture({ tasks: [task({ description })], flags: [flag(), flag({ key: "htpr-2-other", ticketId: "HTPR-2" })] });
    const report = triageFlagsColumn({ ...f, apply: true });
    assert.equal(report.clean, false);
    assert.equal(report.tickets[0].label, null);
    assert.equal(f.writes().filter(([, args]) => args[0] === "task").length, 0);
    assert.deepEqual(f.state.tasks[0].labels, [{ name: "Bug" }]);
    triageFlagsColumn({ ...f, apply: true });
    assert.equal((f.state.comments["HTPR-7549"] ?? []).filter((comment) => comment.text.includes(clarification)).length, 1);
  }
});

test("the retired signup flag never silently becomes a different ticket-specific flag", async () => {
  const { inspectTicket } = await load();
  for (const index of [7549, 7550, 7551]) {
    const report = inspectTicket(task({ ticketNumber: `HTPR-${index}` }), [flag({ key: `htpr-${index}-replacement`, ticketId: `HTPR-${index}` })], []);
    assert.equal(report.label, null);
    assert.equal(report.flagUrl, null);
    assert.equal(report.ask, true);
    assert.ok(report.issues.includes(`Unknown or removed flag keys: ${key}`));
  }
});

test("multiple flags registered to one ticket remain an explicit clarification, not a guessed audience", async () => {
  const { inspectTicket } = await load();
  const report = inspectTicket(task({ description: "", ticketNumber: "HTPR-5906" }), [
    flag({ key: "htpr-5906-no-phone-nudges", ticketId: "HTPR-5906" }),
    flag({ key: "htpr-5906-shortcut-nudges", ticketId: "HTPR-5906", mode: "EVERYONE" }),
  ], []);
  assert.equal(report.label, null);
  assert.equal(report.ask, true);
  assert.ok(report.issues.includes("Multiple flag keys; declare one governing flag"));
  const declared = inspectTicket(task({ description: "<p>Flag: htpr-5906-shortcut-nudges</p>", ticketNumber: "HTPR-5906" }), [
    flag({ key: "htpr-5906-no-phone-nudges", ticketId: "HTPR-5906" }),
    flag({ key: "htpr-5906-shortcut-nudges", ticketId: "HTPR-5906", mode: "EVERYONE" }),
  ], []);
  assert.equal(declared.label, "flag:everyone");
  assert.equal(declared.flagUrl, "https://app.hypertask.ai/admin/flags/htpr-5906-shortcut-nudges");
});

test("an unambiguous comment resolves a shared flag and still requests its declaration", async () => {
  const { inspectTicket } = await load();
  const report = inspectTicket(task({ description: "<p>Shared signup change.</p>" }), [flag()], [{ text: `<p>Behind ${key}.</p>` }]);
  assert.equal(report.label, "flag:owner-only");
  assert.equal(report.ask, true);
});

test("clean data is a positive control for missing-link and state-label checks", async () => {
  const { triageFlagsColumn } = await load();
  const f = fixture({ tasks: [task({ description: `<p><a href='${flagUrl}'>${key}</a></p>`, labels: [{ name: "Bug" }, { name: "flag:owner-only" }] })] });
  assert.equal(triageFlagsColumn(f).clean, true);
  assert.deepEqual(triageFlagsColumn(f).tickets[0].issues, []);
  assert.deepEqual(f.writes(), []);
});

test("a bare card URL does not count as a clickable link; relative card anchors do", async () => {
  const { inspectTicket } = await load();
  assert.equal(inspectTicket(task({ description: `<p>${flagUrl}</p>` }), [flag()], []).addLink, true);
  assert.equal(inspectTicket(task({ description: `<p><a href='/admin/flags/${key}'>Flag</a></p>` }), [flag()], []).addLink, false);
});

test("all task and comment pages are read, including an existing clarification on a later page", async () => {
  const { triageFlagsColumn, clarification } = await load();
  const first = task({ description: "<p>Undeclared.</p>" });
  const second = task({ ticketNumber: "HTPR-7550", url: "https://app.hypertask.ai/detail/project-15/7550" });
  const f = fixture({ intercept(binary, args) {
    if (binary !== "hypertask") return;
    if (args[0] === "tasks" && args[1] === "list") return args.includes("--cursor")
      ? { success: true, tasks: [second], total: 2 }
      : { success: true, tasks: [first], total: 2, nextCursor: "task-page-2" };
    if (args[0] === "comment" && args[2] === "HTPR-7549") return args.includes("--cursor")
      ? { success: true, comments: [{ text: clarification }], total: 2 }
      : { success: true, comments: [{ text: "Earlier comment" }], total: 2, nextCursor: "comment-page-2" };
  } });
  const report = triageFlagsColumn(f);
  assert.equal(report.tickets.length, 2);
  assert.equal(report.tickets[0].ask, false);
  assert.equal(report.clean, false);
  assert.deepEqual(f.writes(), []);
});

test("missing columns, incomplete pages, repeated cursors and invalid flag reads fail closed before repair", async () => {
  const { triageFlagsColumn } = await load();
  const cases = [
    [(binary, args) => binary === "hypertask" && args[0] === "sections" ? { success: true, sections: [] } : undefined, /no Flags column/],
    [(binary) => binary.endsWith("/ht-flag") ? { flags: [{ key, mode: "NEW_MODE" }] } : undefined, /Invalid live flag/],
    [(binary, args) => binary === "hypertask" && args[0] === "tasks" && args[1] === "list" ? { success: true, tasks: [task()], total: 2 } : undefined, /Incomplete tasks/],
    [(binary, args) => binary === "hypertask" && args[0] === "comment" ? { success: true, comments: [], has_more: true } : undefined, /Incomplete comments/],
    [(binary, args) => binary === "hypertask" && args[0] === "tasks" && args[1] === "list" ? { success: true, tasks: [task()], nextCursor: "same" } : undefined, /Repeated tasks cursor/],
  ];
  for (const [intercept, expected] of cases) {
    const f = fixture({ intercept });
    assert.throws(() => triageFlagsColumn({ ...f, apply: true }), expected);
    assert.deepEqual(f.writes(), []);
  }
  const f = fixture({ intercept() { throw new Error("read unavailable"); } });
  assert.throws(() => triageFlagsColumn(f), /read unavailable/);
});

test("repair rereads the ticket and skips one that has left Flags", async () => {
  const { triageFlagsColumn } = await load();
  const f = fixture({ intercept(binary, args) {
    if (binary === "hypertask" && args[0] === "tasks" && args[1] === "get") return { success: true, tasks: [task({ section: "Done" })] };
  } });
  const report = triageFlagsColumn({ ...f, apply: true });
  assert.deepEqual(report.tickets, []);
  assert.equal(f.writes().filter(([, args]) => args[0] !== "labels").length, 0);
});

test("repair verifies writes rather than claiming a failed repair is clean", async () => {
  const { triageFlagsColumn } = await load();
  const f = fixture({ intercept(binary) { if (binary === "vcc") return { success: true }; } });
  assert.equal(triageFlagsColumn({ ...f, apply: true }).clean, false);
});

test("the Mini Boss CEO timer schedules four read-only reports daily without embedding credentials", () => {
  const read = (suffix) => readFileSync(path.join(__dirname, `../scripts/flags/triage-flags-column.${suffix}`), "utf8");
  assert.match(read("timer"), /^OnCalendar=\*-\*-\* 00\/6:00:00$/m);
  assert.match(read("timer"), /^Persistent=true$/m);
  assert.match(read("service"), /Mini Boss CEO/);
  assert.match(read("service"), /^ExecStart=\/usr\/bin\/env node scripts\/flags\/triage-flags-column\.mjs$/m);
  assert.match(read("service"), /^SuccessExitStatus=2$/m);
  assert.doesNotMatch(read("service"), /--apply|Bearer|TOKEN=/);
});
