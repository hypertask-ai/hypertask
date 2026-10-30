const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const KEY = "htpr-7055-chat-overlays-ticket";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function sourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const next = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(next, found);
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(next);
  }
  return found;
}

test("the released chat-overlays flag definition is gone", () => {
  assert.equal(fs.existsSync(path.join(root, "src/lib/flags/definitions", `${KEY}.ts`)), false);
  const named = sourceFiles("src").filter((file) => read(file).includes("HTPR_7055_CHAT_OVERLAYS_TICKET_FLAG"));
  assert.deepEqual(named, [], "no source file may name the retired flag symbol");
});

test("ticket pages keep the overlay branch the flag used to guard", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /overlayTicket: true/);
  assert.doesNotMatch(layout, /7055/);
  assert.match(read("src/components/AI_CHAT/AI_Chat_Closed_Layout.tsx"), /isDetailPage \? DETAIL_PAGE_MIN_WIDTH : 340/);
});

test("smoke mode snapshot and the layout-lock ratchet no longer carry the flag", () => {
  const modes = require("../e2e/smoke/production-flag-modes.json");
  assert.equal(Object.prototype.hasOwnProperty.call(modes.modes, KEY), false);
  const entries = require("../e2e/smoke/layout-lock-matrix.flag-changes.json");
  assert.deepEqual(entries.filter((entry) => entry.flag === KEY), []);
});

test("one migration deletes the stored flag row", () => {
  const migrations = fs.readdirSync(path.join(root, "src/prisma/migrations"));
  const statements = migrations
    .map((name) => path.join(root, "src/prisma/migrations", name, "migration.sql"))
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => fs.readFileSync(file, "utf8").split("\n"))
    .filter((line) => line.includes(KEY));
  assert.deepEqual(statements, [`DELETE FROM "FeatureFlag" WHERE "key" = '${KEY}';`]);
});
