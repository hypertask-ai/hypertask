const test = require("node:test");

test("a hidden change in this file never runs", { skip: "stands in for a picker that silently selects only skipped tests" }, () => {
  throw Error("this assertion never runs, so the file cannot prove the change");
});
