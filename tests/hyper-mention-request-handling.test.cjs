const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("HyperAI mention requests do not require a client-supplied owner", () => {
  const route = read("src/app/api/ai/hyper-mentioned/route.ts");

  assert.match(
    route,
    /ownerId: z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/,
  );
  assert.match(route, /select: \{ id: true, userId: true \}/);
  assert.match(route, /writableTask\.userId \?\? body\.ownerId/);
});

test("invalid HyperAI mention payloads return a short 400 response", () => {
  const route = read("src/app/api/ai/hyper-mentioned/route.ts");

  assert.match(route, /hyperMentionRequestSchema\.safeParse\(/);
  assert.match(
    route,
    /if \(!parsedBody\.success\) \{[\s\S]*?error: "Invalid HyperAI request"[\s\S]*?status: 400/,
  );
});

test("HyperAI mention clients reject missing task context without a request", () => {
  const hook = read("src/hooks/MultiPages/Tasks/useHyperMention.ts");

  assert.doesNotMatch(hook, /taskIds\[0\] \?\? -1/);
  assert.equal(
    (hook.match(/HyperAI could not reply: missing task context/g) || []).length,
    2,
  );
  assert.ok(
    (hook.match(/console\.warn\(/g) || []).length >= 2,
    "both mention request paths should warn about missing task context",
  );
  assert.match(hook, /\.\.\.\(ownerId !== undefined \? \{ ownerId \} : \{\}\)/);
  assert.doesNotMatch(hook, /processedAttachments:/);
});

test("HyperAI mention clients report every failed response and network error", () => {
  const hook = read("src/hooks/MultiPages/Tasks/useHyperMention.ts");

  assert.equal((hook.match(/if \(!response\.ok\)/g) || []).length, 2);
  assert.match(hook, /data\?\.error \|\| data\?\.message/);
  assert.match(hook, /HyperAI could not reply\. Try again\./);
  assert.equal((hook.match(/toast\.error\(DEFAULT_HYPERAI_ERROR\)/g) || []).length, 2);
  assert.doesNotMatch(hook, /if \(response\.status === 403\)/);
});
