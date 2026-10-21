import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import flag, { HTPR_7379_INBOX_ACTIONS_NO_OUTLINE_FLAG } from "../src/lib/flags/definitions/htpr-7379-inbox-actions-no-outline";
import { descriptionContainerId } from "../src/lib/constants/TaskDetail";

const extensions = (Module as unknown as { _extensions: Record<string, (module: { exports: unknown }) => void> })._extensions;
extensions[".scss"] = (module) => { module.exports = {}; };
extensions[".css"] = (module) => { module.exports = {}; };
const { inboxActionsRowClassName } = require("../src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent") as typeof import("../src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent");

const descriptionSelected = descriptionContainerId;
const selectedBoxIds = [descriptionSelected, "comment", "comment-input", "comment-3"];

test("with the flag on, the inbox action row never takes the selected box's class, so it never gets that box's outline", () => {
  for (const currentId of selectedBoxIds) {
    const classes = inboxActionsRowClassName(currentId, true).split(" ");
    assert.ok(!classes.includes(currentId), `${currentId} leaked into ${classes.join(" ")}`);
  }
});

test("with the flag on, the row keeps its layout classes", () => {
  const classes = inboxActionsRowClassName(descriptionSelected, true).split(" ");
  for (const layout of ["mb-[8px]", "flex", "items-center", "justify-evenly", "gap-[8px]", "text-text-light-gray"]) {
    assert.ok(classes.includes(layout), `missing ${layout}`);
  }
});

test("with the flag off, the row keeps the old selected box class", () => {
  assert.ok(inboxActionsRowClassName(descriptionSelected, false).split(" ").includes("description-container"));
});

test("the fix ships as a bugfix flag", () => {
  assert.equal(flag.key, HTPR_7379_INBOX_ACTIONS_NO_OUTLINE_FLAG);
  assert.equal(flag.kind, "bugfix");
});
