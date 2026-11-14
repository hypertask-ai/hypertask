"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const label = require("../scripts/task-writer-label-eval.cjs");

const FIXTURES = path.join(__dirname, "fixtures/task-writer-label-eval");

test("jev answers become probabilities and the threshold decides what is kept", () => {
  const { probabilities } = label.parseJevAnswers({ answers: { label_0: { type: "noul", noul: 0.91 }, label_1: { type: "noul", noul: 0.79 } } }, ["Bug", "Quick wins"]);
  assert.deepEqual(probabilities, { Bug: 0.91, "Quick wins": 0.79 });
  assert.deepEqual(label.keepSureLabels(probabilities, 0.8), ["Bug"]);
  assert.equal(label.jevRequest({ title: "t", text: "x" }, ["Bug"]).questions.label_0.type, "noul");
});

test("today's writer sees only the labels that fit the vocabulary budget", () => {
  const many = Array.from({ length: 109 }, (_, index) => ({ id: `id-${index}-0123456789abcdef`, name: `Label ${index}` }));
  const visible = label.writerVocabulary(many, 4000);
  assert.ok(visible.length > 0 && visible.length < many.length, "the budget must cut the list");
  assert.ok(`labels:${JSON.stringify([...visible, many[visible.length]])}`.length > 4000, "one more label must not fit");
});

test("a writer answer is read back as label names, and scoring counts right, wrong and missed", () => {
  assert.deepEqual(label.parseLabelAnswer('```json\n["Bug", "quick WINS"]\n```', ["Bug", "Quick wins", "Task Writer"]), ["Bug", "Quick wins"]);
  const scored = label.scoreArm([
    { id: "a", gold: ["Bug", "Infra"], predicted: ["Bug"] },
    { id: "b", gold: ["Bug"], predicted: ["Bug", "Infra"] },
    { id: "c", gold: ["Bug"], predicted: [] },
    { id: "d", gold: ["Bug"], predicted: ["Bug"], error: "HTTP 500" },
  ]);
  assert.deepEqual([scored.errors, scored.silent, scored.tp, scored.fp, scored.fn], [1, 1, 2, 1, 2]);
  assert.deepEqual([scored.precision, scored.recall], [2 / 3, 0.5]);
});

test("the verdict keeps Jev only when it wins on right labels and on wrong ones", () => {
  const today = { recall: 0.4, precision: 0.3, f1: 0.34, cases: 10, errors: 0, latency: { p50: 1000 } };
  const arm = (recall, precision) => ({ recall, precision, f1: (2 * recall * precision) / (recall + precision), cases: 10, errors: 0, latency: { p50: 200 } });
  assert.equal(label.verdict([{ label: "Jev", arm: arm(0.5, 0.35) }], today).keep, true);
  assert.match(label.verdict([{ label: "Jev", arm: arm(0.5, 0.2) }], today).answer, /DROP/);
});

test("the committed corpus hides the labels and the committed scores rebuild the report", () => {
  label.verifyCorpus();
  const saved = JSON.parse(fs.readFileSync(path.join(FIXTURES, "scores.json"), "utf8"));
  const result = label.assemble(label.loadCorpus(), saved.startedAt, saved.rows, saved.threshold);
  assert.equal(label.renderReport(result), fs.readFileSync(path.join(FIXTURES, "report.md"), "utf8").replace(/\n+$/, ""));
});
