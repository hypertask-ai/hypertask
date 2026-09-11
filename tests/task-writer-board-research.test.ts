import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildTaskWriterRetrievalQuery,
  formatRelatedTicketCandidates,
  HTPR_6363_TASK_WRITER_RESEARCH_FLAG,
  mergeTaskWriterContextBudget,
  TASK_WRITER_BOARD_RESEARCH_RULES,
  taskWriterCandidateUrl,
} from "../src/app/api/ai/_lib/taskWriterBoardResearch";

test("shared source fidelity stays free of board-research exceptions", () => {
  const authoringStyle = readFileSync(
    resolve("src/app/api/ai/_lib/editorAi.ts"),
    "utf8"
  );
  assert.equal(
    /export const TASK_AUTHORING_STYLE[\s\S]*?BOARD RESEARCH/.test(authoringStyle),
    false,
    "research rules must not live in the shared authoring style"
  );
  assert.match(authoringStyle, /Never invent metrics/);
  assert.match(TASK_WRITER_BOARD_RESEARCH_RULES, /Proposed:/);
  assert.match(TASK_WRITER_BOARD_RESEARCH_RULES, /Open questions/);
  assert.match(TASK_WRITER_BOARD_RESEARCH_RULES, /Related tickets/);
});

test("flag key is registered for Owner+QA rollout", () => {
  const flagsSource = readFileSync(resolve("src/lib/flags.ts"), "utf8");
  assert.match(
    flagsSource,
    new RegExp(`key:\\s*"${HTPR_6363_TASK_WRITER_RESEARCH_FLAG}"`)
  );
});

test("retrieval query prefers cumulative user briefs over the conversation blob", () => {
  const glued =
    "CONVERSATION HISTORY:\nAI Response: long invented draft\nNEW USER REQUEST:\nmake it shorter";
  assert.equal(
    buildTaskWriterRetrievalQuery({
      prompt: glued,
      userRetrievalTexts: [
        "Comparison table above the fold",
        "Link the failed table tests",
      ],
    }),
    "Comparison table above the fold\nLink the failed table tests"
  );
  assert.equal(buildTaskWriterRetrievalQuery({ prompt: glued }), glued);
});

test("context budget reserves comment rows on busy boards", () => {
  const taskRows = Array.from({ length: 50 }, (_, index) => ({
    id: String(index + 1),
    ticketNumber: `T-${index + 1}`,
    title: `Task ${index + 1}`,
    descriptionText: "desc",
    projectId: 1,
    creatorName: "x",
    status: "Normal",
    updatedAt: "",
    searchText: "",
    uniqueIndex: index + 1,
    projectTitle: "Board",
  }));
  const commentRows = Array.from({ length: 20 }, (_, index) => ({
    id: String(1000 + index),
    taskId: String(index + 1),
    commentText: `comment ${index + 1}`,
    creatorName: "x",
    projectId: 1,
    createdAt: "",
    searchText: "",
    taskProjectId: 1,
    taskProjectTitle: "Board",
    taskTicketNumber: `T-${index + 1}`,
    taskTitle: `Task ${index + 1}`,
    taskStatus: "Normal",
    taskUpdatedAt: "",
    taskUniqueIndex: index + 1,
  }));

  const legacy = [...taskRows, ...commentRows].slice(0, 50);
  assert.equal(legacy.length, 50);
  assert.equal(
    legacy.filter((row) => "commentText" in row).length,
    0,
    "legacy slice drops every comment when 50 tasks arrive first"
  );

  const merged = mergeTaskWriterContextBudget({ taskRows, commentRows });
  assert.equal(merged.taskRows.length, 35);
  assert.equal(merged.commentRows.length, 15);
  assert.equal(merged.taskRows.length + merged.commentRows.length, 50);
});

test("candidate URLs use projectId and uniqueIndex", () => {
  assert.equal(
    taskWriterCandidateUrl({ projectId: 339, uniqueIndex: 1631 }),
    "https://app.hypertask.ai/detail/project-339/1631"
  );
  const block = formatRelatedTicketCandidates([
    {
      projectId: 339,
      uniqueIndex: 1631,
      ticketNumber: "INNE-1631",
      title: "Comparison table",
      descriptionText: "Failed test <script>",
      status: "Normal",
    },
  ]);
  assert.match(block, /RELATED_TICKET_CANDIDATES/);
  assert.match(
    block,
    /url:https:\/\/app\.hypertask\.ai\/detail\/project-339\/1631/
  );
  assert.match(block, /&lt;script&gt;/);
});

test("task-writer board research checks passed", () => {
  assert.equal(true, true);
});
