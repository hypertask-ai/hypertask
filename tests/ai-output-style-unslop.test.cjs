const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

// HTPR-5587: every AI surface shares HOUSE_OUTPUT_STYLE, so the anti-slop
// rules must live there (em dash ban, chatbot phrases, word blacklist).
// Chat additionally gets ADHD shaping (action-first steps, one next action);
// that must NOT leak into the shared block, because the rewrite modes
// (ImproveReadability etc.) are forbidden from adding content to user text.
test("shared house style bans AI tells", () => {
  const src = fs.readFileSync(
    path.join(root, "src/app/api/ai/_lib/editorAi.ts"),
    "utf8",
  );
  const block = src.split("HOUSE_OUTPUT_STYLE = `")[1].split("`;")[0];
  assert.match(block, /Never output an em dash/);
  assert.match(block, /Great question/);
  assert.match(block, /I hope this helps/);
  assert.match(block, /delve, pivotal, crucial/);
  assert.doesNotMatch(
    block,
    /next action|numbered steps/i,
    "action shaping must stay out of the shared block: rewrite modes may not add content",
  );
});

test("chat prompt adds action-first shaping on top", () => {
  const src = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8",
  );
  const prompt = src.split("AGENT_SYSTEM_PROMPT = `")[1].split("`;")[0];
  assert.match(prompt, /\$\{HOUSE_OUTPUT_STYLE\}/);
  assert.match(prompt, /numbered steps in execution order/);
  assert.match(prompt, /End with one next action/);
  assert.match(prompt, /Cap lists at 5 items/);
});
