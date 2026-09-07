const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("slash commands choose available viewport space and stay inset", () => {
  const renderer = read(
    "src/components/RTE/Extensions/SlashCommands/RenderCommands.tsx",
  );
  const list = read(
    "src/components/RTE/Extensions/SlashCommands/CommandsList.tsx",
  );

  assert.match(renderer, /placement: "auto-start"/);
  assert.match(renderer, /strategy: "fixed"/);
  assert.match(
    renderer,
    /allowedAutoPlacements: \["bottom-start", "top-start"\]/,
  );
  assert.match(
    renderer,
    /fallbackPlacements: \["bottom-start", "top-start"\]/,
  );
  assert.match(renderer, /name: "preventOverflow"/);
  assert.match(renderer, /padding: 12, altAxis: true/);
  assert.match(list, /maxHeight: "calc\(100dvh - 24px\)"/);
  assert.match(list, /min-h-0/);
  assert.match(list, /overflow-y-auto/);
});

test("Agent Chat skill controls follow the ticket feature flag", () => {
  const list = read(
    "src/components/RTE/Extensions/SlashCommands/CommandsList.tsx",
  );
  const library = read("src/components/Modals/Settings/SkillLibrary.tsx");
  const personal = read("src/components/Modals/Settings/SkillsSection.tsx");
  const board = read("src/components/Modals/Settings/BoardSkillsSection.tsx");

  assert.match(list, /useFlag\(AGENT_CHAT_SKILLS_FLAG\)/);
  assert.match(list, /const COMMENT_SKILL_MODE = "create-comment"/);
  assert.match(list, /const AGENT_CHAT_SKILL_MODE = "ai-chat"/);
  assert.match(
    list,
    /mode === COMMENT_SKILL_MODE \|\|\s*\(mode === AGENT_CHAT_SKILL_MODE && agentChatSkillsEnabled\)/,
  );
  assert.match(list, /if \(!skillsEnabled\) \{\s*setSkillItems\(\[\]\)/);
  assert.match(library, /agentChatSkillsEnabled && \(\s*<SettingsCard title="Import from GitHub">/);
  for (const section of [personal, board]) {
    assert.match(
      section,
      /agentChatSkillsEnabled\s*\? "Type \/slug in AI chat, or @hyperai \/slug in a comment\."\s*: "Type @hyperai \/slug in a comment\."/,
    );
  }
});

test("mentions choose available viewport space instead of clipping above mobile editors", () => {
  const renderer = read("src/components/RTE/MentionData.js");
  const list = read("src/components/RTE/MentionList.jsx");

  assert.match(renderer, /placement: "auto-start"/);
  assert.match(renderer, /strategy: "fixed"/);
  assert.match(
    renderer,
    /allowedAutoPlacements: \["bottom-start", "top-start"\]/,
  );
  assert.match(
    renderer,
    /fallbackPlacements: \["bottom-start", "top-start"\]/,
  );
  assert.match(renderer, /name: "preventOverflow"/);
  assert.match(renderer, /padding: 12, altAxis: true/);
  assert.match(list, /max-h-\[min\(18rem,calc\(100dvh_-_24px\)\)\]/);
  assert.match(list, /overflow-y-auto/);
});
