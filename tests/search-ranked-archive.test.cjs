const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const calls = [];
const helperPath = path.join(
  root,
  "src/utils/controllers/turbopuffer/turbopufferHelper.ts"
);
require.cache[helperPath] = {
  id: helperPath,
  filename: helperPath,
  loaded: true,
  exports: {
    searchTasks: async (params) => {
      calls.push(["searchTasks", params]);
      return [
        {
          id: "39321",
          ticketNumber: "HTPR-6365",
          title:
            "Mobile task view shows the blue inbox icon on tasks that are not in the inbox",
          descriptionText: "",
          projectId: 15,
          creatorName: "Valentin",
          status: "Archive",
          updatedAt: "2026-09-10T10:00:00.000Z",
          uniqueIndex: 6365,
          projectTitle: "Hypertask Product",
        },
        {
          id: "39360",
          ticketNumber: "HTPR-6372",
          title: "Search ranking returns unrelated tickets for plain queries",
          descriptionText: "",
          projectId: 15,
          creatorName: "Valentin",
          status: "Normal",
          updatedAt: "2026-09-14T12:00:00.000Z",
          uniqueIndex: 6372,
          projectTitle: "Hypertask Product",
        },
      ];
    },
    searchComments: async (params) => {
      calls.push(["searchComments", params]);
      return [
        {
          id: "1",
          taskId: "39360",
          commentText: "inbox icon returns HTPR-6365 first",
          creatorName: "QA",
          projectId: 15,
          createdAt: "2026-09-14T14:00:00.000Z",
          taskProjectId: 15,
          taskProjectTitle: "Hypertask Product",
          taskTicketNumber: "HTPR-6372",
          taskTitle: "Search ranking returns unrelated tickets for plain queries",
          taskStatus: "Normal",
          taskUpdatedAt: "2026-09-14T12:00:00.000Z",
          taskUniqueIndex: 6372,
        },
      ];
    },
  },
};

const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  cache: false,
  interopDefault: true,
});
const { turbopufferGetDocuments } = jiti(
  path.join(root, "src/utils/controllers/search/document.ts")
);

test("ranked search fetches archived rows and still pins the title match", async () => {
  calls.length = 0;
  const result = await turbopufferGetDocuments("inbox icon", [15], "Normal", {
    contextProjectId: 15,
    applyRelevanceCut: true,
  });
  assert.equal(result.status, 200);
  assert.equal(result.processedData.All[0].ticketNumber, "HTPR-6365");
  assert.equal(result.tabs.includes("Open"), false);
  assert.ok(
    calls.some(
      ([name, params]) => name === "searchTasks" && params.status === null
    )
  );
});

test("archived-only ranked search keeps the archive filter", async () => {
  calls.length = 0;
  const result = await turbopufferGetDocuments("inbox icon", [15], "Archive", {
    contextProjectId: 15,
    applyRelevanceCut: true,
  });
  assert.ok(
    calls.some(
      ([name, params]) => name === "searchTasks" && params.status === "Archive"
    )
  );
  assert.ok(
    calls.every(
      ([name, params]) => name !== "searchTasks" || params.status === "Archive"
    )
  );
  assert.deepEqual(
    result.processedData.All.map((hit) => hit.ticketNumber),
    ["HTPR-6365"]
  );
});

test("ranked ticket search pins an archived ticket first", async () => {
  const result = await turbopufferGetDocuments("HTPR-6365", [15], "Normal", {
    contextProjectId: 15,
    applyRelevanceCut: true,
  });
  assert.equal(result.status, 200);
  assert.equal(result.processedData.All[0].ticketNumber, "HTPR-6365");
});

console.log("ranked archive search checks passed");
