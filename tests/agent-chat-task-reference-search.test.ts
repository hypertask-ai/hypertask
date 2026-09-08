import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  combineTaskSearchResults,
  exactTaskReferenceWhere,
} from "../src/utils/controllers/tasks/searchAll";

const root = path.resolve(import.meta.dirname, "..");

const task = (
  id: number,
  ticketNumber: string,
  updatedAt: string,
  title = ticketNumber,
) => ({ id, ticketNumber, updatedAt, title });

for (const query of ["HTPR-6033", "HTPR6033", "htpr 6033"]) {
  assert.deepEqual(exactTaskReferenceWhere(query), {
    ticketNumber: {
      equals: "HTPR-6033",
      mode: "insensitive",
    },
  });
}
assert.deepEqual(exactTaskReferenceWhere("6033"), { uniqueIndex: 6033 });
assert.equal(exactTaskReferenceWhere("16033 notes"), null);

const exact = task(6033, "HTPR-6033", "2026-09-01T10:00:00.000Z");
const newer = task(
  6002,
  "HTPR-6002",
  "2026-09-08T10:00:00.000Z",
  "Agent Chat HTPR-6033 follow-up",
);
const next = task(6027, "HTPR-6027", "2026-09-07T10:00:00.000Z");

const ranked = combineTaskSearchResults(
  [exact],
  [newer],
  // The exact task is deliberately absent, as if it fell beyond take: 40.
  [newer, next],
);
assert.deepEqual(
  ranked.map((item) => item.ticketNumber),
  ["HTPR-6033", "HTPR-6002", "HTPR-6027"],
);
assert.equal(
  ranked.filter((item) => item.id === newer.id).length,
  1,
  "deduplication still holds after the exact lookup",
);

const controllerSource = fs.readFileSync(
  path.join(root, "src/utils/controllers/tasks/searchAll.ts"),
  "utf8",
);
const controllerCatch = controllerSource.slice(
  controllerSource.lastIndexOf("} catch"),
);
assert.match(
  controllerCatch,
  /status: 500/,
  "a task search failure must reject the client request instead of looking empty",
);

const source = fs.readFileSync(
  path.join(root, "src/app/agents/chat/AgentChatClient.tsx"),
  "utf8",
);
const searchEffect = source.slice(
  source.indexOf("// Same endpoint and request shape"),
  source.indexOf("const pickMention"),
);
const popover = source.slice(
  source.indexOf("{mentionOpen && ("),
  source.indexOf("<textarea", source.indexOf("{mentionOpen && (")),
);

assert.match(source, /const mentionSearchGenRef = useRef\(0\)/);
assert.match(searchEffect, /setMentionLoading\(true\)/);
assert.match(searchEffect, /myGen !== mentionSearchGenRef\.current/);
assert.match(searchEffect, /setMentionLoadError\(true\)/);
assert.match(popover, /mentionLoading/);
assert.match(popover, /Loading tasks…/);
assert.match(popover, /mentionLoadError/);
assert.match(popover, /Couldn&apos;t load tasks/);

console.log("agent-chat-task-reference-search: all checks passed");
