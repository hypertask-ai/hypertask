const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/htpr-8285-task-attachment-file-source.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { mapTaskToMcpGetResponse, taskMcpGetInclude } = jiti(
  path.join(root, "src/lib/mcp/tasks/mappers.ts")
);

const fileSource =
  "https://files.hypertask.app/tasks/attachments/86285_ticket_ba0001282783b691_case-ticket-phone.png_ba0001282783b691";

const baseTask = {
  id: 85847,
  uniqueIndex: 8285,
  projectId: 15,
  title: "t",
  description: "",
  project: { title: "Hypertask Product", staleWarnDays: null, staleHotDays: null },
  createdAt: new Date("2026-11-02T00:00:00Z"),
  _count: { comments: 0 },
};

test("a ticket read gives agents the location of each attachment, so the picture can be opened", () => {
  const task = {
    ...baseTask,
    attachments: [
      { id: 24817, fileName: "case-ticket-phone.png", fileType: "image/png", fileSize: "107269", fileSource },
    ],
  };

  const out = mapTaskToMcpGetResponse(task, 6);

  assert.equal(out.attachments.length, 1);
  assert.equal(out.attachments[0].id, 24817);
  assert.equal(out.attachments[0].fileSource, fileSource);
  assert.equal(out.attachments[0].fileSize, 107269);
});

test("the ticket read asks for the attachment location it returns", () => {
  const include = taskMcpGetInclude(6);

  assert.equal(include.attachments.select.fileSource, true);
});

test("an attachment row without a stored location reports an empty location, never undefined", () => {
  const task = {
    ...baseTask,
    attachments: [{ id: 1, fileName: "a.png", fileType: "image/png", fileSize: "1", fileSource: null }],
  };

  assert.equal(mapTaskToMcpGetResponse(task, 6).attachments[0].fileSource, "");
});
