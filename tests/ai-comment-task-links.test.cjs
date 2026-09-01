const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routePath = path.join(
  process.cwd(),
  "src/app/api/ai/chat/stream/route.ts"
);
const source = fs.readFileSync(routePath, "utf8");

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `Missing ${startMarker}`);
  assert.notEqual(end, -1, `Missing ${endMarker}`);
  return source.slice(start, end);
}

test("AI chat validates resolved task links before writing comments", () => {
  const rule = sourceBetween(
    "const COMMENT_TASK_LINK_RULE",
    "const AGENT_SYSTEM_PROMPT"
  );
  assert.match(rule, /relative .*url.* field exactly/i);
  assert.match(rule, /task title as the link text/i);
  assert.match(rule, /ticket number only when.*title/i);
  assert.match(rule, /Never leave a resolved ticket number as plain text/i);
  assert.match(rule, /validate.*before/i);
  assert.match(rule, /task detail, Inbox, and every other/i);

  const prompt = sourceBetween("const AGENT_SYSTEM_PROMPT", "const statusSchema");
  assert.match(prompt, /COMMENT_TASK_LINK_RULE/);
  assert.doesNotMatch(
    prompt,
    /href="\/detail\/project-\{\{projectId\}\}\/\{\{(?:uniqueIndex|taskId)\}\}"/
  );
});

test("comment tools linkify resolved ticket references before every write", () => {
  const addCommentTool = sourceBetween(
    "hypertask_add_comment: tool({",
    "hypertask_decision_request: tool({"
  );
  const updateCommentTool = sourceBetween(
    "hypertask_update_comment: tool({",
    "hypertask_delete_comment: tool({"
  );
  const draftTool = sourceBetween(
    "hypertask_draft: tool({",
    "hypertask_time_report: tool({"
  );

  assert.match(addCommentTool, /COMMENT_TASK_LINK_RULE/);
  assert.match(updateCommentTool, /COMMENT_TASK_LINK_RULE/);
  assert.match(draftTool, /COMMENT_TASK_LINK_RULE/);
  assert.equal((addCommentTool.match(/await linkifyTicketRefs/g) || []).length, 1);
  assert.equal((updateCommentTool.match(/await linkifyTicketRefs/g) || []).length, 1);
  assert.equal((draftTool.match(/await linkifyTicketRefs/g) || []).length, 3);
});
