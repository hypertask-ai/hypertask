const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Models pad tool calls with empty values for fields they were never asked to touch.
// This payload is not hypothetical: it is the literal JSON gpt-5.5 sent to
// hypertask_update_task when asked to swap one tag for another, captured off the
// running chat route. Note `labels: []` sitting next to a correct add/remove pair.
// Because [] is not undefined, the tool read it as "replace all labels with none"
// and deleted every tag on the task before adding the new one. Same story for
// `description: ""`, which silently wiped the task's description.
const REAL_MODEL_PAYLOAD = {
  task_id: 22802,
  ticket_number: "",
  unique_index: 1,
  project_id: 2038,
  title: "Probe swap task",
  description: "",
  priority: "No Priority",
  due_date: null,
  status: "Normal",
  section: 1,
  labels: [],
  add_labels: ["AI"],
  remove_labels: ["AI Task Writer"],
};

const UPDATE_FIELDS = [
  "title",
  "description",
  "labels",
  "add_labels",
  "remove_labels",
  "ticket_number",
  "due_date",
];

function loadDropEmptyPadding() {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/app/api/ai/chat/stream/route.ts"),
    "utf8"
  );
  const start = source.indexOf("function dropEmptyPadding");
  assert.notEqual(start, -1, "dropEmptyPadding must exist in the chat route");
  const end = source.indexOf("/** Wraps a tool's execute", start);
  const js = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(`${js}; return dropEmptyPadding;`)();
}

const dropEmptyPadding = loadDropEmptyPadding();

test("empty labels padding is dropped, so a tag swap cannot wipe the task's tags", () => {
  const cleaned = dropEmptyPadding(REAL_MODEL_PAYLOAD, UPDATE_FIELDS);
  // If `labels` survives as [], setTaskLabels(task, []) deletes every tag.
  assert.equal("labels" in cleaned, false);
  // The real intent must survive untouched.
  assert.deepEqual(cleaned.add_labels, ["AI"]);
  assert.deepEqual(cleaned.remove_labels, ["AI Task Writer"]);
});

test("empty description padding is dropped, so an update cannot blank the description", () => {
  const cleaned = dropEmptyPadding(REAL_MODEL_PAYLOAD, UPDATE_FIELDS);
  assert.equal("description" in cleaned, false);
});

test("empty ticket_number padding is dropped so it cannot poison task resolution", () => {
  const cleaned = dropEmptyPadding(REAL_MODEL_PAYLOAD, UPDATE_FIELDS);
  assert.equal("ticket_number" in cleaned, false);
  assert.equal(cleaned.task_id, 22802);
});

test("due_date: null still clears the date -- null is intent, not padding", () => {
  // Only "" and [] are padding. null is how a caller explicitly clears a due date,
  // so dropping it would remove a real capability.
  const cleaned = dropEmptyPadding({ due_date: null }, UPDATE_FIELDS);
  assert.equal("due_date" in cleaned, true);
  assert.equal(cleaned.due_date, null);
});

test("real values are never dropped", () => {
  const cleaned = dropEmptyPadding(
    { title: "Real title", labels: ["AI"], description: "<p>text</p>" },
    UPDATE_FIELDS
  );
  assert.equal(cleaned.title, "Real title");
  assert.deepEqual(cleaned.labels, ["AI"]);
  assert.equal(cleaned.description, "<p>text</p>");
});

test("a whitespace-only string counts as padding, not content", () => {
  const cleaned = dropEmptyPadding({ title: "   " }, UPDATE_FIELDS);
  assert.equal("title" in cleaned, false);
});

test("an explicit full-replace label set still replaces", () => {
  // The destructive path must stay reachable when the user really does state
  // the complete final tag list.
  const cleaned = dropEmptyPadding({ labels: ["AI", "stale"] }, UPDATE_FIELDS);
  assert.deepEqual(cleaned.labels, ["AI", "stale"]);
});
