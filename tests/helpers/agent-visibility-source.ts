import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readAgentDetailSource } from "./agent-detail-source.cjs";

export async function assertAgentVisibilitySources() {
  const [
    detail,
    providerRoute,
    agentRoute,
    activityRoute,
    notificationsRoute,
    tokenRoute,
    inboxPage,
    taskDetailLoad,
    createSessionRoute,
    existingSessionRoute,
    existingSessionMessagesRoute,
    chatAccessModule,
    assignRoute,
  ] = await Promise.all([
    readAgentDetailSource(),
    readFile("src/app/api/agents/[agentId]/provider-key/route.ts", "utf8"),
    readFile("src/app/api/agents/[agentId]/route.ts", "utf8"),
    readFile("src/app/api/agents/[agentId]/activity/route.ts", "utf8"),
    readFile("src/app/api/agents/[agentId]/notifications/route.ts", "utf8"),
    readFile("src/app/api/agents/[agentId]/mcp-token/route.ts", "utf8"),
    readFile("src/app/inbox/agent/[agentId]/page.tsx", "utf8"),
    readFile("src/utils/controllers/taskDetail/load.ts", "utf8"),
    readFile("src/app/api/ai-chat/create-session/route.ts", "utf8"),
    readFile("src/app/api/agent-chat/[sessionId]/route.ts", "utf8"),
    readFile("src/app/api/agent-chat/[sessionId]/messages/route.ts", "utf8"),
    readFile("src/lib/agents/chatAccess.ts", "utf8"),
    readFile("src/lib/mcp/operations/assignees/assign/operation.ts", "utf8"),
  ]);
  assert.match(detail, /<InfoRow label="Visibility">/);
  assert.match(detail, /<AgentOption value="PRIVATE">Private<\/AgentOption>/);
  assert.match(detail, /<AgentOption value="TEAM">Team<\/AgentOption>/);
  assert.match(
    detail,
    /agent\.runtimeType === "NATIVE" && !providerKeyLoaded/,
  );
  assert.match(
    detail,
    /Team members will use your plan for this agent\. Continue\?/,
  );
  assert.equal(
    detail.match(/savingProviderKey \|\| savingVisibility/g)?.length,
    4,
  );
  assert.match(
    detail,
    /Provider key removed\. This agent is now private\./,
  );
  assert.match(providerRoute, /deleteOwnedAgentProviderKey\(/);
  assert.match(providerRoute, /upsertOwnedAgentProviderKey\(/);
  assert.match(agentRoute, /setOwnedAgentVisibility\(/);
  assert.match(agentRoute, /warning: result\.warning/);
  assert.match(
    taskDetailLoad,
    /agentId: visibleAgent \? task\.agentId : null,[\s\S]*agent: visibleAgent/,
  );
  assert.doesNotMatch(taskDetailLoad, /hiddenCommentAgent\(userId\)/);
  assert.equal(
    taskDetailLoad.match(
      /hiddenCommentAgent\(userId, Prisma\.sql`comment_task\."projectId"`\)/g,
    )?.length,
    2,
  );
  assert.match(
    taskDetailLoad,
    /hiddenCommentAgent\(userId, Prisma\.sql`ti\."projectId"`\)/,
  );
  assert.match(
    taskDetailLoad,
    /agent\.id IS NULL AND c\."agentDisplayName" IS NOT NULL/,
  );
  assert.match(taskDetailLoad, /visibility_agent_member\."agentId" = agent\.id/);
  assert.match(
    taskDetailLoad,
    /INNER JOIN "Task" comment_task ON comment_task\.id = c\."taskId"/,
  );
  assert.match(
    taskDetailLoad,
    /visibility_agent_member\."projectId" = \$\{projectId\}/,
  );
  assert.match(taskDetailLoad, /visibility_project\.status = 'Normal'/);
  assert.match(
    taskDetailLoad,
    /agent\.visibility = 'TEAM'::"AgentVisibility"[\s\S]*?AND \(\$\{hasAccessibleAgentProject\(userId, projectId\)\}\)/,
  );
  assert.match(
    taskDetailLoad,
    /SELECT t\.id, t\."projectId" FROM "Task" t[\s\S]*?task_row AS \(SELECT id AS "taskId", "projectId" FROM authorized_task\)/,
  );
  assert.match(createSessionRoute, /\.\.\.accessibleAgentWhere\(userId\)/);
  // HTPR-6002 moved this rule out of each route into one shared module, so the
  // routes are checked for delegation and the rule itself is checked once,
  // where it now lives. revokedAt must come after the spread: the other order
  // lets a future key in accessibleAgentWhere overwrite the revocation guard.
  for (const existingSessionSurface of [
    existingSessionRoute,
    existingSessionMessagesRoute,
  ]) {
    assert.match(existingSessionSurface, /loadUserAgentChatSession\(/);
    assert.doesNotMatch(existingSessionSurface, /prisma\.chatSession\.findFirst\(/);
  }
  assert.match(
    chatAccessModule,
    /agent: \{[\s\S]*?\.\.\.accessibleAgentWhere\(userId\),[\s\S]*?revokedAt: null,/,
  );
  assert.match(
    assignRoute,
    /agentAssigner: \{[\s\S]*?select: mcpVisibleAgentSelect\(ctx\.user\.id, task\.projectId\)/,
  );
  assert.match(
    assignRoute,
    /mapVisibleMcpAgent\([\s\S]*?row\.agentAssigner,[\s\S]*?ctx\.user\.id,[\s\S]*?task\.projectId/,
  );
  assert.match(assignRoute, /if \(row\.agent && !agent\) return \[\]/);
  for (const ownerSurface of [
    agentRoute,
    activityRoute,
    notificationsRoute,
    tokenRoute,
    inboxPage,
  ]) {
    assert.match(ownerSurface, /getSessionUser\(/);
    assert.doesNotMatch(ownerSurface, /JSON\.parse\(userCookie\.value\)/);
  }
  assert.equal(inboxPage.match(/!Number\.isInteger\(userObj\.id\)/g)?.length, 2);
  assert.equal(inboxPage.match(/typeof userId !== "number"/g)?.length, 2);
  assert.doesNotMatch(
    inboxPage,
    /where: \{ id: params\.agentId, userId: userObj\.id \}/,
  );

}
