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
