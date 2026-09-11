import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mcpAddedMemberResponse,
  mcpPendingInviteResponse,
  resolveMcpAddMemberTarget,
} from "../src/lib/mcp/projects/addMemberTarget";

describe("resolveMcpAddMemberTarget", () => {
  it("routes numeric IDs to direct user add", () => {
    assert.deepEqual(resolveMcpAddMemberTarget(2343), {
      kind: "user_id",
      userId: 2343,
    });
  });

  it("routes agent UUIDs to agent add", () => {
    assert.deepEqual(
      resolveMcpAddMemberTarget("b7ad06ff-1aaa-4a64-937d-f7fd801506e5"),
      {
        kind: "agent",
        agentId: "b7ad06ff-1aaa-4a64-937d-f7fd801506e5",
      },
    );
  });

  it("routes emails to invite path", () => {
    assert.deepEqual(resolveMcpAddMemberTarget("qa@example.com"), {
      kind: "email",
      email: "qa@example.com",
    });
  });

  it("rejects empty or malformed targets", () => {
    assert.equal(resolveMcpAddMemberTarget("").kind, "invalid");
    assert.equal(resolveMcpAddMemberTarget(0).kind, "invalid");
    assert.equal(resolveMcpAddMemberTarget("not-an-email").kind, "invalid");
  });
});

describe("mcp member response shapes", () => {
  it("marks email invites as pending_invite so success is not mistaken for membership", () => {
    assert.deepEqual(mcpPendingInviteResponse(15, "invite-1"), {
      success: true,
      projectId: 15,
      status: "pending_invite",
      inviteId: "invite-1",
    });
  });

  it("returns member details for direct adds", () => {
    assert.deepEqual(
      mcpAddedMemberResponse(15, "added", {
        id: 99,
        userId: 2343,
        displayName: "QA Two",
        email: "qa2@example.com",
      }),
      {
        success: true,
        projectId: 15,
        status: "added",
        member: {
          id: 99,
          userId: 2343,
          displayName: "QA Two",
          email: "qa2@example.com",
        },
      },
    );
  });
});

console.log("mcp add project member tests passed");
