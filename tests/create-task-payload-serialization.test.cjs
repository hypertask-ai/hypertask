const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const createJiti = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true });
const { createSerializableTaskPayload } = jiti(
  path.join(root, "src/utils/api/global/createTaskPayload.ts")
);

test("create-task payload drops browser objects before Axios serialization", () => {
  class BrowserWindow {
    constructor() {
      this.window = this;
    }
  }

  const payload = createSerializableTaskPayload({
    title: "Pricing requirements",
    projectId: 339,
    priority: new BrowserWindow(),
    description: "<p>Complete requirements</p>",
    fullScreenTask: true,
  });

  assert.deepEqual({ ...payload }, {
    title: "Pricing requirements",
    projectId: 339,
    description: "<p>Complete requirements</p>",
    fullScreenTask: true,
  });
  assert.doesNotThrow(() => JSON.stringify(payload));
});

test("create-task payload rejects a circular optional field as one unit", () => {
  const circular = { priority_index: 1 };
  circular.window = circular;

  const payload = createSerializableTaskPayload({
    title: "Pricing requirements",
    projectId: 339,
    priority: circular,
  });

  assert.equal(payload.priority, undefined);
  assert.equal(JSON.stringify(payload), '{"title":"Pricing requirements","projectId":339}');
});

test("create-task payload preserves valid nested values and dates", () => {
  const payload = createSerializableTaskPayload({
    title: "Pricing requirements",
    dueDate: new Date("2026-08-18T20:00:00.000Z"),
    tags: [{ id: "label-1", name: "Pricing", color: undefined }],
    assignees: [
      {
        id: 4,
        uid: "user-4",
        displayName: "The_Aalian",
        avatar: undefined,
      },
    ],
    relationsToAdd: [{ uniqueIndex: "1569", projectId: "339" }],
    optionalIndexes: [1, undefined, 3],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    title: "Pricing requirements",
    dueDate: "2026-08-18T20:00:00.000Z",
    tags: [{ id: "label-1", name: "Pricing" }],
    assignees: [{ id: 4, uid: "user-4", displayName: "The_Aalian" }],
    relationsToAdd: [{ uniqueIndex: "1569", projectId: "339" }],
    optionalIndexes: [1, null, 3],
  });
});
