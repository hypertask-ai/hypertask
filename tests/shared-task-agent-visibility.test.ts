import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const agentRecord = (id: string, displayName: string) => ({
  id,
  displayName,
  email: `${id}@example.test`,
  photoURL: `https://example.test/${id}.png`,
});

async function main() {
  process.env.DATABASE_URL =
    "postgresql://unused:unused@localhost:5432/unused";

  const { PRIVATE_AGENT_DISPLAY_NAME, redactAgentIdentitiesForPublicShare } =
    await import("@/lib/agents/publicAgent");
  const { redactSharedComments } = await import("@/utils/controllers/tasks/getSharedTask");

  const humanComment = {
    id: "human-comment",
    text: "Human comment",
    agentId: null,
    agentDisplayName: null,
    agent: null,
    creator: {
      id: 42,
      displayName: "Human author",
      email: "human@example.test",
      photoURL: "https://example.test/human.png",
    },
    activity: {
      type: "TaskMove",
      data: {
        fromUser: { id: 42, displayName: "Human author" },
      },
    },
  };
  const activeAgentComment = {
    id: "active-agent-comment",
    text: "Agent comment",
    agentId: "agent-active-id",
    agentDisplayName: null,
    agent: agentRecord("agent-active-id", "Active Agent"),
    creator: { id: 42, displayName: "Human author" },
    activity: {
      type: "TaskAssigned",
      data: {
        fromAgentId: "agent-active-id",
        fromAgent: agentRecord("agent-active-id", "Active Agent"),
        toAgent: agentRecord("agent-target-id", "Target Agent"),
        agentAssigner: agentRecord("agent-assigner-id", "Assigner Agent"),
        assignedAgents: [agentRecord("agent-target-id", "Target Agent")],
        agents: [agentRecord("agent-active-id", "Active Agent")],
        task: { id: 99, title: "Nested task", agentId: "agent-target-id" },
      },
    },
  };
  const deletedAgentComment = {
    id: "deleted-agent-comment",
    text: "Deleted agent comment",
    agentId: null,
    agentDisplayName: "Deleted Agent",
    agent: null,
    creator: { id: 42, displayName: "Human author" },
  };
  const comments = [humanComment, activeAgentComment, deletedAgentComment];
  const originalComments = structuredClone(comments);

  const redactedComments = redactSharedComments(comments);

  assert.deepEqual(redactedComments[0], humanComment);
  for (const comment of redactedComments.slice(1)) {
    assert.equal(comment.agentId, null);
    assert.equal(comment.agent, null);
    assert.equal(comment.agentDisplayName, PRIVATE_AGENT_DISPLAY_NAME);
  }
  const redactedActivity = (
    redactedComments[1] as unknown as {
      activity: typeof activeAgentComment.activity;
    }
  ).activity;
  assert.deepEqual(redactedActivity.data.fromAgent, {
    displayName: PRIVATE_AGENT_DISPLAY_NAME,
    photoURL: null,
  });
  assert.deepEqual(redactedActivity.data.toAgent, {
    displayName: PRIVATE_AGENT_DISPLAY_NAME,
    photoURL: null,
  });
  assert.deepEqual(redactedActivity.data.agentAssigner, {
    displayName: PRIVATE_AGENT_DISPLAY_NAME,
    photoURL: null,
  });
  assert.deepEqual(redactedActivity.data.assignedAgents, [
    { displayName: PRIVATE_AGENT_DISPLAY_NAME, photoURL: null },
  ]);
  assert.deepEqual(redactedActivity.data.agents, [
    { displayName: PRIVATE_AGENT_DISPLAY_NAME, photoURL: null },
  ]);
  assert.equal(redactedActivity.data.fromAgentId, null);
  assert.equal(redactedActivity.data.task.agentId, null);
  assert.equal(
    (redactedActivity.data as Record<string, unknown>).isSelfAssignment,
    false,
  );
  const [selfAssignment] = redactSharedComments([
    {
      ...activeAgentComment,
      activity: {
        ...activeAgentComment.activity,
        data: {
          ...activeAgentComment.activity.data,
          toAgent: activeAgentComment.activity.data.fromAgent,
        },
      },
    },
  ]);
  assert.equal(
    (
      (selfAssignment.activity as Record<string, unknown>)
        .data as Record<string, unknown>
    ).isSelfAssignment,
    true,
  );
  const numericSelfAssignment = redactAgentIdentitiesForPublicShare({
    fromAgent: { id: 7, displayName: "Legacy Agent" },
    toAgent: { id: 7, displayName: "Legacy Agent" },
  });
  assert.equal(
    (numericSelfAssignment as { isSelfAssignment?: boolean }).isSelfAssignment,
    true,
  );
  assert.deepEqual(numericSelfAssignment.fromAgent, {
    displayName: PRIVATE_AGENT_DISPLAY_NAME,
    photoURL: null,
  });
  assert.deepEqual(comments, originalComments, "comment inputs must not be mutated");

  const sharedTask = {
    id: "share-id",
    userAgent: "Mozilla/5.0",
    fallbackAgent: { id: "fallback-agent-id", displayName: "Fallback Agent" },
    agent_id: "snake-agent-id",
    agent_display_name: "Snake Agent",
    task: {
      id: 99,
      agentId: "task-agent-id",
      agentDisplayName: "Task Agent",
      parentTask: { id: 98, agentId: "parent-agent-id" },
      subTasks: [{ id: 100, agentId: "subtask-agent-id" }],
      user: { id: 42, displayName: "Human owner", email: "human@example.test" },
    },
  };
  const originalSharedTask = structuredClone(sharedTask);
  const redactedSharedTask = redactAgentIdentitiesForPublicShare(sharedTask);

  assert.equal(redactedSharedTask.userAgent, "Mozilla/5.0");
  assert.deepEqual(redactedSharedTask.fallbackAgent, {
    displayName: PRIVATE_AGENT_DISPLAY_NAME,
    photoURL: null,
  });
  assert.equal(redactedSharedTask.agent_id, null);
  assert.equal(
    redactedSharedTask.agent_display_name,
    PRIVATE_AGENT_DISPLAY_NAME,
  );
  assert.equal(redactedSharedTask.task.agentId, null);
  assert.equal(
    redactedSharedTask.task.agentDisplayName,
    PRIVATE_AGENT_DISPLAY_NAME,
  );
  assert.equal(redactedSharedTask.task.parentTask.agentId, null);
  assert.equal(redactedSharedTask.task.subTasks[0].agentId, null);
  assert.deepEqual(redactedSharedTask.task.user, sharedTask.task.user);
  assert.deepEqual(sharedTask, originalSharedTask, "task inputs must not be mutated");

  const serialized = JSON.stringify({ redactedComments, redactedSharedTask });
  for (const privateValue of [
    "agent-active-id",
    "agent-target-id",
    "agent-assigner-id",
    "fallback-agent-id",
    "snake-agent-id",
    "task-agent-id",
    "parent-agent-id",
    "subtask-agent-id",
    "Active Agent",
    "Target Agent",
    "Assigner Agent",
    "Fallback Agent",
    "Snake Agent",
    "Deleted Agent",
    "Task Agent",
  ]) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }

  const [
    controller,
    getSharedTaskApi,
    createShareLinkApi,
    activityRenderer,
  ] = await Promise.all([
    readFile("src/utils/controllers/tasks/getSharedTask.ts", "utf8"),
    readFile("src/pages/api/share/getSharedTask.ts", "utf8"),
    readFile("src/pages/api/share/createShareLink.ts", "utf8"),
    readFile(
      "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentTaskActivity.tsx",
      "utf8",
    ),
  ]);
  assert.match(controller, /json: redactSharedComments\(comments\)/);
  assert.match(
    controller,
    /return redactAgentIdentitiesForPublicShare\(shared\)/,
  );
  for (const publicApi of [getSharedTaskApi, createShareLinkApi]) {
    assert.match(
      publicApi,
      /taskShared: redactAgentIdentitiesForPublicShare\(taskShared\)/,
    );
  }
  assert.match(activityRenderer, /activity\.data\.isSelfAssignment \?\?/);
  assert.doesNotMatch(activityRenderer, /(?:from|to)Agent\?\.photoURL\s*\?\?/);

  console.log("shared-task-agent-visibility.test.ts: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
