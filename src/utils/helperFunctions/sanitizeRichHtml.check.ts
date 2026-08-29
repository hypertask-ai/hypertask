// Run: NODE_PATH=/path/to/node_modules node --experimental-strip-types src/utils/helperFunctions/sanitizeRichHtml.check.ts
import assert from "node:assert";
// @ts-ignore -- explicit .ts extension is required by `node --experimental-strip-types`
import { sanitizeRichHtml } from "./sanitizeRichHtml.ts";

const xss = sanitizeRichHtml(
  `<p>Hello<img src="https://example.com/x.png" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)" onclick="bad()">bad</a></p>`,
);
assert.ok(xss.includes('<img src="https://example.com/x.png">'), "safe image src kept");
assert.ok(!xss.includes("onerror"), "image event handler stripped");
assert.ok(!xss.includes("<script"), "script tag stripped");
assert.ok(!xss.includes("alert(2)"), "script content stripped");
assert.ok(!xss.includes("javascript:"), "unsafe href stripped");
assert.ok(!xss.includes("onclick"), "link event handler stripped");

const mention = sanitizeRichHtml(
  `<span data-type="mention" class="mention" data-id="Bob&quot; x" data-label="name-7" uniqueindex="" projectid="">Bob&quot; x</span>`,
);
assert.ok(mention.includes('data-type="mention"'), "mention data-type kept");
assert.ok(mention.includes('data-label="name-7"'), "mention label kept");
assert.ok(mention.includes("Bob&quot; x"), "escaped mention text kept");

const link = sanitizeRichHtml(
  `<a href="/detail/project-15/3976" target="_blank">ticket</a>`,
);
assert.strictEqual(
  link,
  `<a href="/detail/project-15/3976" target="_blank" rel="noopener noreferrer nofollow">ticket</a>`,
  "relative blank-target links get safe rel",
);

const checklist = sanitizeRichHtml(
  `<ul data-type="taskList" data-extra="bad"><li data-type="taskItem" data-checked="true" onclick="bad()">Done</li><li data-type="taskItem" data-checked="false">Todo</li><li data-type="other" data-checked="maybe">Bad</li></ul>`,
);
assert.ok(checklist.includes('<ul data-type="taskList">'), "task list marker kept");
assert.ok(
  checklist.includes('<li data-type="taskItem" data-checked="true">Done</li>'),
  "checked task item marker kept",
);
assert.ok(
  checklist.includes('<li data-type="taskItem" data-checked="false">Todo</li>'),
  "unchecked task item marker kept",
);
assert.ok(!checklist.includes("data-extra"), "unexpected list data attribute stripped");
assert.ok(!checklist.includes('data-type="other"'), "unexpected list data-type stripped");
assert.ok(!checklist.includes('data-checked="maybe"'), "unexpected checked state stripped");
assert.ok(!checklist.includes("onclick"), "list item event handler stripped");

console.log("sanitizeRichHtml.check.ts: all assertions passed");
