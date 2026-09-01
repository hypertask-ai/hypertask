const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/notifications/InboxDraftRow.tsx",
  ),
  "utf8",
);
const notificationRow = fs.readFileSync(
  path.resolve(
    __dirname,
    "../src/components/notifications/NotificationRow.tsx",
  ),
  "utf8",
);

// Inbox rows share the outer `sm:p-inbox-horizontal` inset. Their clickable
// content then adds 20px on mobile and clears it at the desktop breakpoint.
// Keep the draft's Tailwind equivalent (`px-5`) aligned with notification rows.

const openButton = source.match(
  /<button[\s\S]*?data-inbox-draft-control="true"[\s\S]*?className="([^"]*)"/,
);
const notificationContent = notificationRow.match(
  /<TaskRowContainer[\s\S]*?className={`([^`]*)`}/,
);
const container = source.match(/<div\s+className="(group\/draft-row[^"]*)"/);

const expectedButtonClasses = [
  "relative",
  "flex",
  "min-w-0",
  "flex-1",
  "cursor-pointer",
  "flex-col",
  "justify-between",
  "rounded-md",
  "px-5",
  "py-2",
  "pr-14",
  "text-left",
  "outline-none",
  "focus-visible:ring-1",
  "focus-visible:ring-inset",
  "focus-visible:ring-border-active",
  "md:flex-row",
  "md:items-center",
  "md:space-x-8",
  "md:px-0",
  "md:pr-10",
];

const expectedContainerClasses = [
  "group/draft-row",
  "relative",
  "flex",
  "min-w-0",
  "items-center",
  "gap-[8px]",
  "hover:bg-hoverCardBackground",
  "focus-within:bg-hoverCardBackground",
  "sm:p-inbox-horizontal",
  "md:gap-0",
  "md:border-l-4",
  "md:border-l-transparent",
  "md:p-0",
];

test("the draft row keeps the same mobile content inset as notification rows", () => {
  assert.ok(notificationContent, "notification content className not found");
  const notificationClasses = notificationContent[1].trim().split(/\s+/);
  assert.ok(notificationClasses.includes("px-[20px]"));
  assert.ok(notificationClasses.includes("md:px-0"));
  assert.ok(openButton, "open-draft button className not found");
  assert.deepEqual(openButton[1].trim().split(/\s+/), expectedButtonClasses);
});

test("the draft row container itself keeps the shared inbox horizontal padding", () => {
  assert.ok(container, "draft row container className not found");
  assert.deepEqual(container[1].trim().split(/\s+/), expectedContainerClasses);
});
