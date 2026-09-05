const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const CHAT_HOOK = "src/hooks/MultiPages/AIChat/useAiChat.ts";

// WHY (HTPR-6095): AI chat archives/unarchives notifications server-side and
// only tells this tab about it through a Pusher broadcast. That broadcast
// competes with the same tab re-rendering every streamed token, so the inbox
// badge could stay stale long after the chat turn actually finished (13
// notifications archived, badge still showed the pre-archive count). The fix
// self-corrects at stream end instead of waiting on the websocket round trip.
test("the chat stream refetches the inbox query when a turn's 'done' event arrives", () => {
  const source = read(CHAT_HOOK);

  assert.match(
    source,
    /import \{ INBOX_QUERY_KEY \} from "@\/hooks\/Inbox\/useGetNotifications";/,
    "useAiChat must import the same inbox query key the realtime handler refetches"
  );

  const doneCaseAt = source.indexOf('case "done":');
  assert.ok(doneCaseAt > 0, "'done' SSE case not found in useAiChat");
  const blockEndAt = source.indexOf("default:", doneCaseAt);
  assert.ok(
    blockEndAt > doneCaseAt,
    "no following 'default:' found to bound the 'done' case block"
  );
  const doneBlock = source.slice(doneCaseAt, blockEndAt);

  assert.match(
    doneBlock,
    /queryClient\s*\.\s*refetchQueries\(\{[^}]*queryKey:\s*INBOX_QUERY_KEY[^}]*type:\s*"active"[^}]*\}\)/,
    "the 'done' handler must refetch the inbox query so the acting tab self-corrects " +
      "without waiting on the Pusher broadcast"
  );
});
