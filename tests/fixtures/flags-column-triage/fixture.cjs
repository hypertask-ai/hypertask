const assert = require("node:assert/strict");

const key = "htpr-7511-signup-straight-to-board";
const flagUrl = `https://app.hypertask.ai/admin/flags/${key}`;
const flag = (extra = {}) => ({ key, mode: "OWNER_ONLY", kind: "feature", ticketId: "HTPR-7511", ...extra });
const task = (extra = {}) => ({
  ticketNumber: "HTPR-7549", url: "https://app.hypertask.ai/detail/project-15/7549", projectId: 15,
  section: "Flag: Only Me + QA", status: "Normal", description: `<p>Behind ${key}, never Everyone.</p>`, labels: [{ name: "Bug" }], ...extra,
});
const flagSections = () => [
  { section_title: "Flag: Everyone" },
  { section_title: "Flag: Only Me + QA" },
  { section_title: "Flag: Off" },
  { section_title: "No Flag" },
];

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
      if (args[0] === "sections") return { success: true, sections: flagSections() };
      if (args[0] === "tasks" && args[1] === "list") {
        const section = value("--section");
        const listed = section ? state.tasks.filter((entry) => entry.section === section) : state.tasks;
        return structuredClone({ success: true, tasks: listed, total: listed.length });
      }
      if (args[0] === "tasks" && args[1] === "get") return structuredClone({ success: true, tasks: state.tasks.filter((entry) => entry.ticketNumber === args[2]) });
      if (args[0] === "comment") return structuredClone({ success: true, comments: state.comments[args[2]] ?? [] });
      if (args[0] === "labels") return { success: true, labels: boardLabels.map((name) => ({ name })) };
    }
    assert.equal(binary, "vcc", `Unexpected command ${binary} ${args.join(" ")}`);
    if (args[0] === "labels") boardLabels.push(value("--name"));
    else if (args[0] === "comment") (state.comments[args[2]] ??= []).push({ text: value("--text") });
    else if (args[0] === "task") {
      const entry = state.tasks.find((item) => item.ticketNumber === args[2]);
      if (args.includes("--remove-labels")) entry.labels = entry.labels.filter((label) => !value("--remove-labels").split(",").includes(label.name));
      if (args.includes("--add-label")) entry.labels.push({ name: value("--add-label") });
      if (args.includes("--description")) entry.description = value("--description");
    } else assert.fail(`Unexpected write ${args.join(" ")}`);
    return { success: true };
  };
  return { run, calls, state, writes: () => calls.filter(([binary]) => binary === "vcc") };
}

module.exports = { key, flagUrl, flag, task, fixture };
