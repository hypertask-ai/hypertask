const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const load = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  fsCache: false,
});
const { HOUSE_OUTPUT_STYLE } = load(path.join(root, "src/app/api/ai/_lib/editorAiPrompts.ts"));
const { AGENT_SYSTEM_PROMPT } = load(path.join(root, "src/lib/ai/chatStream/prompt.ts"));

test("shared house style bans AI tells", () => {
  assert.match(HOUSE_OUTPUT_STYLE, /Never output an em dash/);
  assert.match(HOUSE_OUTPUT_STYLE, /Great question/);
  assert.match(HOUSE_OUTPUT_STYLE, /I hope this helps/);
  assert.match(HOUSE_OUTPUT_STYLE, /delve, pivotal, crucial/);
  assert.doesNotMatch(
    HOUSE_OUTPUT_STYLE,
    /next action|numbered steps/i,
    "action shaping must stay out of the shared block: rewrite modes may not add content",
  );
});

test("chat prompt adds action-first shaping on top", () => {
  assert.ok(AGENT_SYSTEM_PROMPT.includes(HOUSE_OUTPUT_STYLE));
  assert.match(AGENT_SYSTEM_PROMPT, /numbered steps in execution order/);
  assert.match(AGENT_SYSTEM_PROMPT, /End with one next action/);
  assert.match(AGENT_SYSTEM_PROMPT, /Cap lists at 5 items/);
});
