import assert from "node:assert/strict";
import test from "node:test";

import {
  findNewTaskUrlSection,
  parseNewTaskUrlTarget,
} from "../src/lib/newTaskUrl";

test("parses a board and column bookmark", () => {
  assert.deepStrictEqual(
    parseNewTaskUrlTarget({ board: "15", column: "Bugs" }),
    { boardId: 15, columnId: undefined, columnTitle: "Bugs" },
  );
});

test("accepts numeric column ids and keeps legacy board links working", () => {
  assert.deepStrictEqual(
    parseNewTaskUrlTarget({ id: "15", column: "42" }),
    { boardId: 15, columnId: 42, columnTitle: undefined },
  );
});

test("rejects malformed or non-positive bookmark ids", () => {
  assert.deepStrictEqual(
    parseNewTaskUrlTarget({ board: "15x", column: "0" }),
    { boardId: undefined, columnId: undefined, columnTitle: "0" },
  );
});

test("matches a requested column within the selected board", () => {
  const sections = [
    { id: 41, section_title: "Todo" },
    { id: 42, section_title: "Bugs" },
  ];

  assert.deepStrictEqual(
    findNewTaskUrlSection(sections, { columnTitle: " bugs " }),
    sections[1],
  );
  assert.equal(
    findNewTaskUrlSection(sections, { columnId: 99 }),
    undefined,
  );
});
