const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const createJiti = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
});
const { getAvatarInitials, hasCustomAvatar } = jiti(
  path.join(root, "src/lib/avatar.ts"),
);

test("builds two-letter initials for people and agents", () => {
  assert.equal(getAvatarInitials("Bug Fixer"), "BF");
  assert.equal(getAvatarInitials("QA Agent"), "QA");
  assert.equal(getAvatarInitials("Abdul"), "AB");
});

test("handles whitespace, Unicode, and missing names", () => {
  assert.equal(getAvatarInitials("  Élodie   张  "), "É张");
  assert.equal(getAvatarInitials("🤖 Agent"), "🤖A");
  assert.equal(getAvatarInitials("👩‍💻 Engineer"), "👩‍💻E");
  assert.equal(getAvatarInitials("👩🏽‍💻 Engineer"), "👩🏽‍💻E");
  assert.equal(getAvatarInitials("🇩🇪 Berlin"), "🇩🇪B");
  assert.equal(getAvatarInitials("élodie Smith"), "ÉS");
  assert.equal(getAvatarInitials("istanbul agent"), "IA");
  assert.equal(getAvatarInitials("ßmile Builder"), "SB");
  assert.equal(getAvatarInitials(""), "?");
  assert.equal(getAvatarInitials(null), "?");
});

test("treats the legacy generic image as an absent avatar", () => {
  const legacy =
    "https://files.hypertask.app/tasks/attachments/1757584422625image.png";
  const historicalLegacy =
    "https://duv2gcpdgd578.cloudfront.net/tasks/attachments/1757584422625image.png";
  assert.equal(hasCustomAvatar(undefined), false);
  assert.equal(hasCustomAvatar("  "), false);
  assert.equal(hasCustomAvatar(legacy), false);
  assert.equal(hasCustomAvatar(`${legacy}?cache=1`), false);
  assert.equal(hasCustomAvatar(historicalLegacy), false);
  assert.equal(hasCustomAvatar(`${historicalLegacy}#cached`), false);
  assert.equal(hasCustomAvatar("https://example.com/custom.png"), true);
});

test("agent photo removal remains nullable from the modal through the route", () => {
  const modal = fs.readFileSync(
    path.join(root, "src/components/Modals/Agent/agent.modal.tsx"),
    "utf8",
  );
  const route = fs.readFileSync(
    path.join(root, "src/app/api/agents/[agentId]/route.ts"),
    "utf8",
  );

  assert.match(modal, /photoURL:\s*customPhotoURL/);
  assert.match(route, /body\.photoURL === null/);
  assert.match(route, /data\.photoURL = null/);
});

test("keeps the current-user sidebar avatar compact on mobile", () => {
  const sidebar = fs.readFileSync(
    path.join(
      root,
      "src/components/sidebars/RightSidebar/CurrentUserSidebar.tsx",
    ),
    "utf8",
  );

  assert.match(
    sidebar,
    /<UserAvatar[\s\S]*?className="sm:!h-7 sm:!w-7"[\s\S]*?compactOnMobile/,
  );
});
