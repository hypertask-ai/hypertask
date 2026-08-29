const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const CHAT_HOOK = "src/hooks/MultiPages/AIChat/useAiChat.ts";
const PALETTE = "src/components/Modals/commands/HTC/commands.tsx";
const SIDEBAR = "src/components/AI_CHAT/AI_Chat_Sidebar.tsx";
const COMMAND_LIST = "src/components/Modals/commands/HTC/CommandList.tsx";
const SUMMARIZE = "src/hooks/MultiPages/AIChat/useCommentToAiChat.ts";

// WHY: Ctrl+K "Summarize ticket" appeared to do nothing. The cleanup that cancels an
// in-flight stream lived on an effect keyed on [chatRoute, currentStreamingSession, token].
// A cleanup runs on every dependency change, not only on unmount, and `token` starts null
// and resolves asynchronously. Summarize opens the chat and sends in the same breath, so
// the token routinely landed mid-stream, the cleanup fired, and the stream the user was
// waiting on was cancelled. Confirmed on production: every send logged
// /api/ai/chat/stream 200 immediately followed by /api/ai/chat/cancel 200.

test("page unload leaves the stream running while cleanup remains unmount-only", () => {
  const source = read(CHAT_HOOK);
  assert.doesNotMatch(
    source,
    /addEventListener\(["']beforeunload["']/,
    "mobile suspension or eviction must not ask the server to cancel the reply"
  );

  const marker = "// Cancel an active stream only when the provider genuinely unmounts.";
  const at = source.indexOf(marker);
  assert.ok(at > 0, "unmount-only cancel effect not found");
  const effect = source.slice(at, source.indexOf("// `editor` is in the deps", at));
  assert.match(
    effect,
    /useEffect\(\(\) => \{[\s\S]*return \(\) => \{[\s\S]*\};\s*\}, \[\]\);/,
    "the cancellation cleanup must run only on a genuine provider unmount"
  );
});

test("a stream is registered synchronously, so an immediate unmount cannot miss it", () => {
  const source = read(CHAT_HOOK);
  const start = source.indexOf("// Set current streaming session for cancellation");
  assert.ok(start > 0, "stream-start site not found");
  const startBlock = source.slice(start, start + 220);
  const refMatch = startBlock.match(
    /streamingSessionRef\.current = ([^;]+);/
  );
  const stateMatch = startBlock.match(
    /setCurrentStreamingSession\(([^)]+)\)/
  );
  const refAt = refMatch?.index ?? -1;
  const stateAt = stateMatch?.index ?? -1;
  assert.ok(refAt >= 0, "the stream start must record the session in a ref");
  assert.ok(stateAt >= 0, "the stream start must record the session in state");
  assert.equal(
    refMatch[1].trim(),
    stateMatch[1].trim(),
    "the ref and state must register the same resolved session"
  );
  assert.ok(
    refAt < stateAt,
    "the ref must be set before the state: state only reaches the unmount handler after a " +
      "commit, so a tab closed in between would leave the stream running"
  );
});

test("the unmount handler reads the synchronous ref, not committed state", () => {
  const source = read(CHAT_HOOK);
  const effectStart = source.indexOf(
    "// Cancel an active stream only when the provider genuinely unmounts."
  );
  assert.ok(effectStart > 0, "unmount handler not found");
  const effect = source.slice(
    effectStart,
    source.indexOf("// `editor` is in the deps", effectStart)
  );
  const cleanup = effect.slice(effect.indexOf("return () => {"));
  assert.match(
    cleanup,
    /if \(streamingSessionRef\.current\)/,
    "the unmount cleanup must gate on the ref, not on a captured render value"
  );
  assert.doesNotMatch(
    cleanup,
    /\bcurrentStreamingSession\b/,
    "reading the state variable here recaptures a stale render and misses fresh streams"
  );
});

test("cancelling gates on the ref, or the unmount cancel is a silent no-op", () => {
  const source = read(CHAT_HOOK);
  const fn = source.slice(source.indexOf("const handleCancelStream = async () => {"));
  const body = fn.slice(0, fn.indexOf("\n  };"));
  assert.match(
    body,
    /streamingSessionRef\.current\s*\?\?\s*currentStreamingSession/,
    "handleCancelStream early-returns on its own closure; without the ref it would " +
      "no-op for a stream that started before the last commit"
  );
});

test("failed cancellation keeps the active stream registered for another Stop attempt", () => {
  const source = read(CHAT_HOOK);
  const fn = source.slice(source.indexOf("const handleCancelStream = async () => {"));
  const body = fn.slice(0, fn.indexOf("\n  };"));
  const catchBlock = body.slice(body.indexOf("} catch (error) {"));
  assert.match(body, /!response\.ok[\s\S]*result\?\.success !== true/);
  assert.match(body, /response\.status === 409[\s\S]*result\?\.status === "completed"/);
  assert.match(
    body,
    /streamingSessionRef\.current !== sessionId[\s\S]*streamingAssistantMessageRef\.current !== assistantMessageId[\s\S]*streamingRequestRef\.current !== streamId/,
  );
  assert.doesNotMatch(catchBlock, /streamingSessionRef\.current = null/);
  assert.doesNotMatch(catchBlock, /setCurrentStreamingSession\(null\)/);
  assert.match(catchBlock, /Try Stop again/);
});

test("the command palette centres on the space left by the AI chat panel", () => {
  assert.match(
    read(PALETTE),
    /modalClassName="pr-\[var\(--ht-ai-sidebar-width,0px\)\]"/,
    "palette must pad by the panel width; reactstrap's outer .modal takes no inline style"
  );
  assert.match(
    read(SIDEBAR),
    /setProperty\(\s*"--ht-ai-sidebar-width"/,
    "the sidebar must publish its width, or the palette has nothing to read"
  );
  assert.match(
    read(SIDEBAR),
    /setProperty\(\s*"--ht-ai-sidebar-width",\s*"0px"\s*\)/,
    "closing the panel must reset the variable or the palette stays offset"
  );
});

// Measured 1.11:1 against the selected row in dark theme, where WCAG asks for 4.5:1.
// A solid fill does not depend on what is behind it, so one rule covers both themes.
test("the New badge does not rely on a translucent tint for contrast", () => {
  const source = read(COMMAND_LIST);
  const badge = source.slice(source.indexOf("{isNew && ("), source.indexOf("New\n"));
  assert.doesNotMatch(
    badge,
    /bg-hypertasks-purple\/\d+/,
    "a tinted background leaves the badge unreadable on a dark selected row"
  );
  assert.match(badge, /bg-hypertasks-purple\b/, "badge needs a solid fill");
  assert.match(badge, /text-white\b/, "badge needs light text on that fill");
});

test("the summarize prompt carries no em dash, since the user sees it verbatim", () => {
  assert.doesNotMatch(read(SUMMARIZE), /—/, "em dash is banned in user-visible copy");
});
