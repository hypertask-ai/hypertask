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

// HTPR-5866: the open-draft button carried a mobile-only `px-5` on top of the
// row container's shared `sm:p-inbox-horizontal`, double-padding the DRAFT row
// (~32px vs the 12px notification rows use). The container's shared inbox
// padding is the single horizontal source on mobile; the button only keeps
// vertical rhythm (`py-2`), right-side clearance for the archive control
// (`pr-14`), and the desktop declarations (`md:px-0`, `md:pr-10`). Both class
// lists are asserted exactly so any padding change, in any Tailwind syntax,
// fails here and forces a conscious update.

const openButton = source.match(
  /<button[\s\S]*?data-inbox-draft-control="true"[\s\S]*?className="([^"]*)"/,
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

test("the draft row button adds no horizontal padding beyond the shared row padding", () => {
  assert.ok(openButton, "open-draft button className not found");
  assert.deepEqual(openButton[1].trim().split(/\s+/), expectedButtonClasses);
});

test("the draft row container itself keeps the shared inbox horizontal padding", () => {
  assert.ok(container, "draft row container className not found");
  assert.deepEqual(container[1].trim().split(/\s+/), expectedContainerClasses);
});
