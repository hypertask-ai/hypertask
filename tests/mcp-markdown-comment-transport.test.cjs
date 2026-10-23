const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { CommentService } = jiti(
  path.join(root, "src/lib/mcp-server/lib/services/comment.service.ts")
);

function recordingClient() {
  const requests = [];
  return {
    requests,
    async makeRequest(url, options) {
      requests.push({ url, body: JSON.parse(options.body) });
      return {
        success: true,
        comment: {
          id: 42,
          text: "<p><strong>Done</strong></p>",
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      };
    },
  };
}

test("comment service accepts inferred markdown without adding a format hint", async () => {
  const client = recordingClient();

  await new CommentService(client).addComment({
    ticket_number: "HTPR-5984",
    text: "**Done**\n\n1. First\n2. Second",
  });

  assert.equal(client.requests[0].url, "/mcp/comments");
  assert.equal(client.requests[0].body.content_type, undefined);
  assert.equal(client.requests[0].body.text, "**Done**\n\n1. First\n2. Second");
});

test("comment updates forward an explicit markdown format hint", async () => {
  const client = recordingClient();

  await new CommentService(client).updateComment({
    comment_id: 42,
    text: "**Updated**",
    content_type: "markdown",
  });

  assert.equal(client.requests[0].url, "/mcp/comments/42");
  assert.equal(client.requests[0].body.content_type, "markdown");
  assert.equal(client.requests[0].body.text, "**Updated**");
});


test("comment kind reaches the MCP POST unchanged", async () => {
  const client = recordingClient();
  await new CommentService(client).addComment({ task_id: 42, text: "A decision?", kind: "question" });
  assert.equal(client.requests[0].body.kind, "question");
});

test("log-routed MCP posts return their activity without requiring a comment", async () => {
  const logged = { success: true, routedTo: "log", visibleToPeople: false, notice: "Saved to the agent log, not the ticket thread. Resend with kind (question|qa|done) to post for people.", url: "https://app.hypertask.ai/detail/project-15/7341", activity: { id: "activity-1" } };
  const client = { makeRequest: async () => logged };
  assert.deepEqual(await new CommentService(client).addComment({ task_id: 42, text: "Progress" }), logged);
});

test("attachments on a log-routed post attach to the task without a comment ID", async () => {
  const requests = [];
  const client = { makeRequest: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return url === '/mcp/comments'
      ? { success: true, routedTo: 'log', activity: { id: 'activity-1' } }
      : { success: true, attachments: [{ id: 1, fileName: 'report.txt', fileType: 'text/plain', fileSize: 6 }] };
  } };
  const response = await new CommentService(client).addComment({ task_id: 42, text: 'Progress', attachments: [{ filename: 'report.txt', content_type: 'text/plain', data: Buffer.from('report').toString('base64') }] });
  assert.equal(response.routedTo, 'log');
  assert.equal(response.attachment_status, 'complete');
  assert.equal(requests[1].url, '/mcp/tasks/attachments');
  assert.equal(requests[1].body.task_id, 42);
  assert.equal(requests[1].body.comment_id, undefined);
});
