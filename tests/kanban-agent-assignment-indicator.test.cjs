const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTopRow.tsx",
  ),
  "utf8",
);

test("Kanban cards show human and agent assignments in the compact area", () => {
  assert.match(source, /agentAssignees: IAgent\[\]/);
  assert.match(source, /assignees\.length > 0 \|\| agentAssignees\.length > 0/);
  assert.match(source, /agentAssignees\.slice\(0, 5\)\.map/);
  assert.match(
    source,
    /name=\{assignee\.displayName\}[\s\S]*?photoURL=\{assignee\.photoURL\}/,
  );
});

test("assigned agents use the task-detail avatar representation", () => {
  const agentAvatars = source.match(
    /\{agentAssignees\.slice\(0, 5\)\.map\(\(agent, index\) => \(([\s\S]*?)\n\s*\)\)\}/,
  );

  assert.ok(agentAvatars, "expected an assigned-agent avatar mapping");
  assert.match(agentAvatars[1], /<UserAvatar/);
  assert.match(
    agentAvatars[1],
    /alt=\{`Assigned agent: \$\{agent\.displayName\}`\}/,
  );
  assert.match(agentAvatars[1], /name=\{agent\.displayName\}/);
  assert.match(agentAvatars[1], /photoURL=\{agent\.photoURL\}/);
  assert.match(agentAvatars[1], /size=\{isMbl \? 18 : 22\}/);
  assert.match(agentAvatars[1], /assignees\.length > 0 \|\| index > 0/);
  assert.doesNotMatch(source, /FaRobot/);
});
