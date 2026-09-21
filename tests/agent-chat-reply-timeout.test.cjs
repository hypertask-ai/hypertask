const { readAgentChatSource } = require("./helpers/read-agent-chat-source.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = readAgentChatSource();

test("polling chat replaces working with a generic notice after three minutes", () => {
  assert.match(source, /AWAITING_POLL_MAX_MS = 3 \* 60 \* 1000/);
  assert.match(source, /const maxWait = pollingChatEnabled[\s\S]*AWAITING_POLL_MAX_MS/);
  assert.match(
    source,
    /setTimeout\([\s\S]*markTimedOut\(\)[\s\S]*}, remaining\)/,
  );
  assert.match(
    source,
    /replyTimedOut \? \([\s\S]*no reply, error logged[\s\S]*is working/,
  );
  assert.match(
    source,
    /replyTimedOut \? \([\s\S]*?\)\}\s*\{chatStopAndTimeoutEnabled[\s\S]*handleStop/,
    "the timeout notice must keep the Stop recovery action available",
  );
  assert.doesNotMatch(source, /replyTimedOut \? \([\s\S]{0,200}(error\?\.|messagesError)/);
});

test("a reloaded unanswered turn keeps its original timeout clock", () => {
  assert.match(
    source,
    /Date\.parse\(messages\?\.at\(-1\)\?\.createdAt \?\? ""\)/,
  );
  assert.match(source, /Number\.isNaN\(latestMessageAt\) \? Date\.now\(\) : latestMessageAt/);
});
