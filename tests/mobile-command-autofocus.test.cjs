const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const readSource = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const pullDownCommandHosts = [
  "src/app/inbox/Inbox.tsx",
  "src/app/inbox/agent/AgentInbox.tsx",
  "src/components/PageComponents/Calendar/index.tsx",
];

test("pull-down command hosts load the palette synchronously", () => {
  for (const relativePath of pullDownCommandHosts) {
    const source = readSource(relativePath);

    assert.match(
      source,
      /import HypertasksCommands from ["']@\/components\/commands["'];/,
      `${relativePath} must statically import the palette`,
    );
    assert.doesNotMatch(
      source,
      /dynamic\(\(\) => import\(["']@\/components\/commands["']\)/,
      `${relativePath} must not defer the palette behind a dynamic import`,
    );
  }
});

test("mobile command input focuses only through the synchronous callback ref", () => {
  const source = readSource(
    "src/components/Modals/commands/HTC/commands.tsx",
  );

  assert.match(
    source,
    /if \(!input \|\| !isMobile\) return;[\s\S]*?el\.focus\(\{ preventScroll: true \}\);/,
  );
  assert.match(source, /autoFocus=\{!isMobile\}[\s\S]*?id="htc-mobile-search"/);
});

test("mobile command opening highlights search without selecting a row", () => {
  const commands = readSource(
    "src/components/Modals/commands/HTC/commands.tsx",
  );
  const useHtc = readSource("src/hooks/MultiPages/HTC/useHTC.tsx");

  assert.match(commands, /useHTC\(allCommands_, emptyQueryCommands, !isMobile\)/);
  assert.match(
    commands,
    /className=\{isMobile[\s\S]*bg-newcomment-well[\s\S]*ring-hypertasks-purple[\s\S]*border-light-black-border-1/,
  );
  assert.match(useHtc, /selectFirstOnEmpty \? emptyQueryCommands\[0\]/);
});
