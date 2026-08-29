const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { directReplyStateForNotification } = jiti(
  path.join(
    root,
    "src/utils/controllers/notifications/agentImportantPermission.ts",
  ),
);
const serviceSource = fs.readFileSync(
  path.join(root, "src/utils/controllers/comments/createCommentService.ts"),
  "utf8"
);
const hyperAiSource = fs.readFileSync(
  path.join(root, "src/app/api/ai/hyper-mentioned/route.ts"),
  "utf8"
);
const inboxSource = fs.readFileSync(
  path.join(root, "src/utils/controllers/notifications/getAll.ts"),
  "utf8"
);
const correlationSource = fs.readFileSync(
  path.join(root, "src/utils/controllers/comments/agentInvocationCorrelation.ts"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    root,
    "src/prisma/migrations/20260814113000_add_notification_direct_reply/migration.sql"
  ),
  "utf8"
);

test("managed agents atomically claim a persisted invocation", () => {
  assert.match(correlationSource, /type: "Mentioned"[\s\S]*agentReplyConsumedAt: null/);
  assert.match(
    correlationSource,
    /updateMany\([\s\S]*id: pending\.id,[\s\S]*type: "Mentioned",[\s\S]*status: "Normal",[\s\S]*agentReplyConsumedAt: null[\s\S]*agentReplyCommentId: replyCommentId[\s\S]*status: "Archive"[\s\S]*archivedAt: consumedAt/
  );
  assert.doesNotMatch(correlationSource, /take: 20/);
  assert.match(correlationSource, /buildAgentInvocationSelector/);
  assert.match(correlationSource, /if \(!selector\) return null/);
  assert.match(correlationSource, /DirectReplyAlreadyHandledError/);
  assert.match(
    serviceSource,
    /const duplicate =[\s\S]*!hasInvocationCorrelation/
  );
});

test("direct replies create a durable Important notification", () => {
  assert.match(
    serviceSource,
    /if \(resolvedDirectReplyUserId != null\)[\s\S]*type: "Mentioned"[\s\S]*directReply: true/
  );
  assert.match(serviceSource, /skipUserIds:[\s\S]*resolvedDirectReplyUserId/);
  assert.match(inboxSource, /directReply: notification\.directReply/);
  assert.doesNotMatch(inboxSource, /earner\.directReply/);
  assert.deepEqual(
    directReplyStateForNotification(
      {
        taskId: 27744,
        type: "Mentioned",
        fromAgentId: "agent-1",
        directReply: false,
      },
      { 27744: ["Mentioned"] },
      new Set(),
    ),
    { directReply: true, directReplyTypes: ["Mentioned"] },
  );
});

test("HyperAI keeps its explicit mention path outside agent invocation dedupe", () => {
  assert.match(hyperAiSource, /data-label="name-\$\{requesterId\}"/);
  assert.doesNotMatch(hyperAiSource, /directReplyUserId:/);
});

test("migration preserves recent unanswered agent requests", () => {
  assert.match(migrationSource, /INTERVAL '30 days'/);
  assert.doesNotMatch(migrationSource, /FROM "Comment"/);
  assert.doesNotMatch(
    migrationSource,
    /SET "agentReplyConsumedAt" = CURRENT_TIMESTAMP\s+WHERE "agentId" IS NOT NULL AND "type" = 'Mentioned';/
  );
});
