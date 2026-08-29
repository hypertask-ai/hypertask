const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("task writer context uses an optional project scope without changing the default", () => {
  const source = read("src/app/api/ai/_lib/editorAi.ts");
  const start = source.indexOf(
    "export async function retrieveTaskWriterContext"
  );
  const end = source.indexOf(
    "export function createDocumentAttachmentSummary",
    start
  );
  const body = source.slice(start, end);
  const taskSearchStart = body.indexOf("searchTasks({");
  const taskSearchEnd = body.indexOf("}),", taskSearchStart);
  const taskSearch = body.slice(taskSearchStart, taskSearchEnd);

  assert.match(body, /projectIds\?: number\[\]/);
  assert.match(
    body,
    /const projectIds = args\.projectIds\?\.length\s*\? args\.projectIds\s*: \[args\.projectId\]/
  );
  assert.equal(
    (body.match(/projectIds,/g) || []).length,
    2,
    "task and comment search must share the resolved project scope"
  );
  assert.doesNotMatch(
    taskSearch,
    /projectId:/,
    "a separate projectId would narrow task search back to the current board"
  );
  assert.match(
    body,
    /retrieveCustomInstructionFileContext\(\{\s*projectId: args\.projectId/,
    "custom instructions must remain scoped to the current board"
  );
});

test("HyperAI mention retrieval spans only boards the mentioning user can access", () => {
  const source = read("src/app/api/ai/hyper-mentioned/route.ts");

  assert.match(
    source,
    /import \{ getProjectWhere \} from "@\/utils\/controllers\/projects\/getAllIncludes"/
  );
  assert.match(
    source,
    /status: "Normal",\s*\.\.\.getProjectWhere\(requestUser\.id\)/
  );
  assert.match(
    source,
    /projectIds:\s*accessibleProjectIds\.length > 0\s*\? accessibleProjectIds\s*: undefined/,
    "an empty access lookup must fall back to current-board retrieval"
  );
});

test("cross-board context stays identifiable and does not produce false access claims", () => {
  const editorSource = read("src/app/api/ai/_lib/editorAi.ts");
  const routeSource = read("src/app/api/ai/hyper-mentioned/route.ts");

  assert.match(editorSource, /row\.ticketNumber \? `ticketNumber:/);
  assert.match(editorSource, /row\.taskTicketNumber \? `ticketNumber:/);
  assert.match(routeSource, /OTHER BOARDS the user can access/);
  assert.match(routeSource, /Never claim you lack access to a board\./);
  assert.match(
    routeSource,
    /If you cannot find something, say you could not find it\./
  );
  assert.match(
    routeSource,
    /The context block labelled "THIS TICKET" is that ticket and is the subject of the request — answer about THIS TICKET\./,
    "the current-ticket anchor must remain intact"
  );
});
