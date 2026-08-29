const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// HTPR-4726: public /share links threw React #418 ("server rendered text didn't
// match the client") because formatDateDifference() derives its string from the
// current time, the runtime timezone and the runtime locale. Vercel renders in
// UTC/en-US, the visitor's browser renders in their own — so the same comment
// read "24 Nov" in the SSR HTML and "25 Nov" after hydration.
//
// These components are server-rendered on /share (a share link is always a cold
// full page load), so they must go through RelativeTime, which defers the string
// until after hydration. Calling the formatter directly in their JSX brings the
// bug back.
const SSR_TASK_DETAIL_COMPONENTS = [
  "src/components/PageComponents/TaskDetail/SharedTask/CommentsAndDescription/Description/DescriptionTopRow.tsx",
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentOptions.tsx",
  "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentCreatedBy.tsx",
  "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/TopRow/DescriptionTopRight.tsx",
];

const read = (relative) =>
  fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("share-rendered task detail components never format dates during SSR", () => {
  for (const relative of SSR_TASK_DETAIL_COMPONENTS) {
    const source = read(relative);
    assert.equal(
      /formatD(ate|ueDate)Difference\s*\(/.test(source),
      false,
      `${relative} calls the timezone-dependent date formatter directly; use <RelativeTime /> so the text is rendered after hydration (HTPR-4726)`,
    );
  }
});

test("RelativeTime renders nothing on the server", () => {
  const source = read("src/components/Common/RelativeTime.tsx");
  // getServerSnapshot must report "not hydrated" so the server and the first
  // client render agree on empty output. If this returns true the component
  // formats during SSR again and the hydration mismatch returns.
  assert.match(source, /getServerSnapshot\s*=\s*\(\)\s*=>\s*false/);
  assert.match(source, /useSyncExternalStore\(\s*subscribe,\s*getSnapshot,\s*getServerSnapshot\s*\)/);
});

test("formatDateDifference output really is timezone dependent", () => {
  // The premise behind the two tests above. If this ever stops being true the
  // whole RelativeTime indirection can be deleted.
  const { execFileSync } = require("node:child_process");
  const script =
    "const d=new Date(Date.now()-3*3600*1000);" +
    "process.stdout.write(d.toLocaleString('en-US',{hour:'numeric',minute:'numeric',hour12:true}))";
  const utc = execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, TZ: "UTC" },
  }).toString();
  const tokyo = execFileSync(process.execPath, ["-e", script], {
    env: { ...process.env, TZ: "Asia/Tokyo" },
  }).toString();
  assert.notEqual(utc, tokyo);
});
