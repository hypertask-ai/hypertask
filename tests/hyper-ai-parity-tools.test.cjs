const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("HyperAI adapts the canonical MCP registry instead of duplicating tools", () => {
  const adapter = read("src/app/api/ai/_lib/hyperAiTools.ts");
  const registry = read("src/lib/mcp-server/tools/index.ts");
  const registeredTools = registry.match(/^  [a-zA-Z][a-zA-Z0-9]+Tool,$/gm) || [];

  assert.ok(registeredTools.length >= 60, "expected the full MCP registry");
  assert.match(adapter, /import \{ MCP_TOOLS \} from "@\/lib\/mcp-server\/tools"/);
  assert.match(adapter, /MCP_TOOLS as unknown as PortableMcpTool\[\]/);
  assert.match(adapter, /HYPER_AI_TOOL_COUNT = MCP_TOOLS\.length/);
  assert.match(adapter, /ACCOUNT_MANAGEMENT_TOOLS/);
  assert.match(adapter, /actingAgentId &&/);
  assert.match(adapter, /Native agents cannot access account management tools\./);
  assert.doesNotMatch(
    adapter,
    /hypertask_list_tasks:\s*tool\(/,
    "the adapter must not grow a second copied tool registry",
  );
});

test("every HyperAI mutation uses exact cross-message confirmation", () => {
  const adapter = read("src/app/api/ai/_lib/hyperAiTools.ts");

  assert.match(adapter, /requireHyperAiCommentConfirmation\(\{/);
  assert.match(adapter, /sessionId = `hyperai:\$\{projectId\}:\$\{taskId\}`/);
  assert.match(adapter, /previewsIssuedThisRequest = new Set<string>\(\)/);
  assert.match(adapter, /buildHyperAiOperationKey\(/);
  assert.match(adapter, /\.sort\(\(\[left\], \[right\]\) => left\.localeCompare\(right\)\)/);
  assert.match(adapter, /confirmed: confirmed === true/);
  assert.match(adapter, /sourceMessageId,/);
  assert.match(adapter, /sourceMessageText,/);
  assert.match(adapter, /sourceMessageCreatedAt,/);
  assert.match(adapter, /confirmation_required: true/);
  assert.match(adapter, /"Nothing changed\./);
  assert.match(adapter, /const \{ confirmed, \.\.\.rawMcpInput \} = record\(rawInput\)/);
  assert.ok(
    adapter.indexOf("requireHyperAiCommentConfirmation({") <
      adapter.indexOf("await mcpTool.execute("),
    "confirmation must run before the MCP mutation",
  );
});

test("hybrid tools distinguish reads from writes and default closed", () => {
  const adapter = read("src/app/api/ai/_lib/hyperAiTools.ts");

  for (const metadataKey of [
    "TASK_DESCRIPTION_HISTORY",
    "LINK_TASKS",
    "BOARD_CONFIG",
    "SECTION_CRUD",
    "PAGE_HISTORY",
    "REPORT_CRUD",
    "DECISION_REQUEST",
    "DRAFT_CRUD",
    "TIME",
  ]) {
    assert.match(adapter, new RegExp(`TOOL_METADATA\\.${metadataKey}\\.name`));
  }
  assert.match(
    adapter,
    /return typeof action !== "string" \|\| !readActions\.has\(action\)/,
    "missing or unknown hybrid actions must be treated as writes",
  );
  assert.match(
    adapter,
    /if \(!readActions\) return !READ_ONLY_TOOLS\.has\(toolName\)/,
    "unclassified and future canonical tools must require confirmation",
  );
  assert.match(
    adapter,
    /const mutationCapable = !READ_ONLY_TOOLS\.has\(mcpTool\.name\)/,
    "unclassified tools must expose the confirmed field",
  );
  assert.match(adapter, /HYPER_AI_SECRET_WEBHOOK_ACTIONS/);
  assert.match(
    adapter,
    /Signing secrets are never written into ticket comments/,
    "credential-bearing webhook actions must stay out of persistent ticket comments",
  );
  assert.match(
    adapter,
    /rawMcpInput\.agent_id === "self"/,
    "native agents must resolve self before using the human-scoped MCP adapter token",
  );
});

test("HyperAI verifies the session and runs a cancellable multi-step tool loop", () => {
  const route = read("src/app/api/ai/hyper-mentioned/route.ts");
  const hook = read("src/hooks/MultiPages/Tasks/useHyperMention.ts");
  const save = read(
    "src/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent.ts",
  );

  assert.match(route, /getSessionUser\(request\.headers\)/);
  assert.match(route, /verifyCookieIdentity\(/);
  assert.match(route, /request\.cookies\.get\(SESSION_COOKIE\)/);
  assert.match(route, /cookieIdentity\.status === "verified"/);
  assert.match(route, /where: \{ id: authenticatedSessionUserId \}/);
  assert.match(route, /cookieClaimId === null \|\| cookieClaimId === sessionBackedUser\.id/);
  assert.match(route, /request\.headers\.has\("Authorization"\)/);
  assert.match(route, /await validateMcpAuth\(request\)/);
  assert.match(route, /!bearerContext\.agentId && !bearerContext\.management/);
  assert.match(route, /actingAgentId: bearerContext\?\.agentId \?\? null/);
  assert.match(route, /sourceType: z\.enum\(\["Description", "Comment"\]\)/);
  assert.match(route, /creatorId: requestUser\.id/);
  assert.match(route, /agentId: null/);
  assert.match(route, /sourceMessageId = `comment:\$\{sourceComment\.id\}`/);
  assert.match(route, /sourceMessageText = sourceComment\.text/);
  assert.match(route, /sourceMessageCreatedAt = sourceComment\.createdAt/);
  assert.match(route, /await isUneditedHyperAiComment\(/);
  assert.match(route, /sourceMessageImmutable,/);
  const createComment = read(
    "src/utils/controllers/comments/createCommentService.ts",
  );
  assert.match(createComment, /await recordHyperAiCommentOrigin\(/);
  assert.match(createComment, /agentId: agentId \?\? null/);
  for (const editPath of [
    "src/utils/controllers/comments/updateCommentService.ts",
    "src/utils/controllers/comments/single.ts",
    "src/utils/controllers/comments/updateComment.ts",
  ]) {
    assert.match(
      read(editPath),
      /await invalidateHyperAiCommentOrigin\(/,
      `${editPath} must permanently invalidate immutable approval receipts`,
    );
  }
  assert.match(route, /const tools = createHyperAiTools\(\{/);
  assert.match(route, /tools,\s*stopWhen: stepCountIs\(12\),\s*abortSignal: request\.signal/);
  assert.match(route, /result\.steps\.flatMap/);
  assert.match(route, /"\[ai\/hyper-mentioned\] tool loop complete"/);
  assert.match(route, /feature: "hyper-mentioned"/);
  assert.match(hook, /sourceType: postFrom/);
  assert.match(hook, /sourceCommentId,/);
  assert.match(save, /sourceCommentId: id/);
  assert.match(save, /sourceCommentId: Number\(data\.id\)/);
});
