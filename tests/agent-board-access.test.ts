import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgentBoardAccess } from "../src/lib/agents/boardAccess";

const boards = [
  { id: 1, name: "Product", teamId: "team-a", teamName: "Hypertask" },
  { id: 2, name: "Android", teamId: "team-a", teamName: "Hypertask" },
  { id: 3, name: "Client", teamId: "team-b", teamName: "Northwind" },
];

describe("agent detail board access", () => {
  it("marks memberships and permits changes only within the agent team", () => {
    const access = buildAgentBoardAccess(boards, [1], ["team-a"]);

    assert.deepEqual(
      access.map(({ id, member, canChange }) => ({ id, member, canChange })),
      [
        { id: 2, member: false, canChange: true },
        { id: 3, member: false, canChange: false },
        { id: 1, member: true, canChange: true },
      ],
    );
    assert.equal(access[1].unavailableReason, "Agent belongs to another team");
  });

  it("lets a boardless agent join any accessible team", () => {
    const access = buildAgentBoardAccess(boards, [], []);
    assert.ok(access.every((board) => board.canChange));
  });

  it("keeps an existing cross-team membership removable", () => {
    const access = buildAgentBoardAccess(boards, [1, 3], ["team-a", "team-b"]);
    assert.equal(access.find((board) => board.id === 3)?.canChange, true);
    assert.equal(access.find((board) => board.id === 2)?.canChange, false);
  });
});
