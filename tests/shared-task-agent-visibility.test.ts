import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main() {
  process.env.DATABASE_URL =
    "postgresql://unused:unused@localhost:5432/unused";

  const [
    {
      PRIVATE_AGENT_DISPLAY_NAME,
      redactAgentIdentitiesForPublicShare,
    },
    { redactSharedComments },
  ] = await Promise.all([
    import("@/lib/agents/publicAgent"),
    import("@/utils/controllers/tasks/getSharedTask"),
  ]);

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
    agent: {
      id: "agent-active-id",
      displayName: "Active Agent",
      email: "active-agent@example.test",
      photoURL: "https://example.test/active-agent.png",
    },
    creator: { id: 42, displayName: "Human author" },
    activity: {
      type: "TaskAssigned",
      data: {
        fromAgentId: "agent-active-id",
        fromAgent: {
          id: "agent-active-id",
          displayName: "Active Agent",
          email: "active-agent@example.test",
          photoURL: "https://example.test/active-agent.png",
        },
        toAgent: {
          id: "agent-target-id",
          displayName: "Target Agent",
          email: "target-agent@example.test",
          photoURL: "https://example.test/target-agent.png",
        },
        agentAssigner: {
          id: "agent-assigner-id",
          displayName: "Assigner Agent",
          email: "assigner-agent@example.test",
          photoURL: "https://example.test/assigner-agent.png",
        },
        assignedAgents: [
          {
            id: "agent-target-id",
            displayName: "Target Agent",
            email: "target-agent@example.test",
          },
        ],
        agents: [
          {
            id: "agent-active-id",
            displayName: "Active Agent",
            email: "active-agent@example.test",
          },
        ],
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
    redactedComments[1] as typeof activeAgentComment
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
  assert.deepEqual(
    comments,
    originalComments,
    "comment inputs must not be mutated",
  );

  const sharedTask = {
    id: "share-id",
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

  assert.equal(redactedSharedTask.task.agentId, null);
  assert.equal(
    redactedSharedTask.task.agentDisplayName,
    PRIVATE_AGENT_DISPLAY_NAME,
  );
  assert.equal(redactedSharedTask.task.parentTask.agentId, null);
  assert.equal(redactedSharedTask.task.subTasks[0].agentId, null);
  assert.deepEqual(redactedSharedTask.task.user, sharedTask.task.user);
  assert.deepEqual(
    sharedTask,
    originalSharedTask,
    "task inputs must not be mutated",
  );

  const serialized = JSON.stringify({ redactedComments, redactedSharedTask });
  for (const privateValue of [
    "agent-active-id",
    "agent-target-id",
    "agent-assigner-id",
    "task-agent-id",
    "parent-agent-id",
    "subtask-agent-id",
    "Active Agent",
    "Target Agent",
    "Assigner Agent",
    "Deleted Agent",
    "Task Agent",
    "active-agent@example.test",
    "target-agent@example.test",
    "assigner-agent@example.test",
    "https://example.test/active-agent.png",
    "https://example.test/target-agent.png",
    "https://example.test/assigner-agent.png",
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

  console.log("shared-task-agent-visibility.test.ts: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
