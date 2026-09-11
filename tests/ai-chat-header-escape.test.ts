import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(root, "src/components/AI_CHAT/ChatHeader.tsx"),
  "utf8",
);

test("ChatHeader consumes Escape while header menus are open", () => {
  assert.match(
    source,
    /if \(!isDropdownOpen && !isOverflowOpen\) return;/,
    "Escape listener must only attach when a header menu is open",
  );
  assert.match(
    source,
    /if \(event\.key !== "Escape"\) return;/,
    "Escape is the only key that closes header menus",
  );
  assert.match(
    source,
    /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/,
    "Escape must stop before TaskDetail navigates back",
  );
  assert.match(
    source,
    /document\.addEventListener\("keydown", closeOnEscape, true\)/,
    "Escape must be captured so TaskDetail never sees it first",
  );
  assert.match(
    source,
    /setIsDropdownOpen\(false\);\s*setIsOverflowOpen\(false\);/,
    "Both session history and ellipsis menus close on Escape",
  );
  console.log("ai-chat-header-escape verification passed");
});
