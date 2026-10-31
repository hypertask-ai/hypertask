const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
  assert.match(source, /getServerSnapshot\s*=\s*\(\)\s*=>\s*false/);
  assert.match(source, /useSyncExternalStore\(\s*subscribe,\s*getSnapshot,\s*getServerSnapshot\s*\)/);
});

test("formatDateDifference output really is timezone dependent", () => {
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
