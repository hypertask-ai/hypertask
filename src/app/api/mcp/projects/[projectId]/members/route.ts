import { NextRequest, NextResponse } from "next/server";
import { validateMcpAuth, checkMcpRateLimit } from "@/lib/mcp/auth";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { getProjectMembers } from "@/utils/controllers/projects/getProjectMembers";
import prisma from "@/lib/prisma";
import { addMemberController } from "@/pages/api/invite/createInviteLink";
import { addAgentToBoard } from "@/utils/controllers/agents/boardMembers";
import { addExistingUserToProject } from "@/utils/controllers/members/addExistingUserToProject";
import isProjectAdmin from "@/utils/controllers/projects/isProjectAdmin";
import { readJsonBody } from "@/lib/mcp/readJsonBody";
import {
  mcpAddedMemberResponse,
  mcpPendingInviteResponse,
  resolveMcpAddMemberTarget,
} from "@/lib/mcp/projects/addMemberTarget";

/**
 * GET /api/mcp/projects/:projectId/members
 *
 * Returns ONLY members of the requested project (owner + project members).
 * Used for @mention resolution and assignee selection.
 *
 * SECURITY (CRITICAL):
 * - Strict project scoping: returns ONLY users who are members of :project_id
 * - Access control: verifies requesting user has permission to view this project
 * - Response integrity: projectId in response matches requested :project_id
 * - Do NOT return users from other projects, workspaces, or boards
 *
 * Auth: MCP JWT (Bearer token)
 * Errors: 401 (invalid/missing JWT), 403 (no permission), 404 (project not found)
 */
export async function GET(request: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized. Invalid or missing authentication token.",
        },
        { status: 401 }
      );
    }
    const user = ctx.user;
    const projectId = parseInt(params.projectId);
    if (isNaN(projectId) || projectId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "project_id must be a positive integer",
          details: { field: "project_id", code: "invalid_format" },
        },
        { status: 400 }
      );
    }

    const access = await validateProjectAccess(projectId, user.id, ctx.agentId);
    if (access.error) {
      const message =
        access.error.status === 403
          ? "User does not have permission to view members of this project"
          : access.error.message;
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        { status: access.error.status }
      );
    }

    // HTPR-3805: this is a "list members" endpoint, not an assignee picker —
    // excludeUserId must not be the caller. Passing it excluded the owner
    // whenever the owner is also the requester (boards with zero Member
    // rows then returned an empty list even though the owner has full access).
    const requestingUserId = user.id;
    const result = await getProjectMembers(
      projectId,
      undefined,
      requestingUserId,
    );

    if (result.error) {
      return NextResponse.json(
        {
          success: false,
          error: result.error.message,
        },
        { status: result.error.status }
      );
    }

    return NextResponse.json(
      {
        success: true,
        members: result.members,
        projectId,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[MCP List Project Members] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, props: { params: Promise<{ projectId: string }> }) {
  const params = await props.params;
  try {
    const rateLimited = await checkMcpRateLimit(request);
    if (rateLimited) return rateLimited;
    const ctx = await validateMcpAuth(request);
    if (!ctx) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized. Invalid or missing authentication token.",
        },
        { status: 401 }
      );
    }
    const user = ctx.user;
    const projectId = parseInt(params.projectId);
    if (isNaN(projectId) || projectId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: "project_id must be a positive integer",
          details: { field: "project_id", code: "invalid_format" },
        },
        { status: 400 }
      );
    }

    const access = await validateProjectAccess(projectId, user.id, ctx.agentId);
    if (access.error) {
      const message =
        access.error.status === 403
          ? "User does not have permission to add members to this project"
          : access.error.message;
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        { status: access.error.status }
      );
    }

    // Match board remove-member: owner or project Admin may change membership.
    // validateProjectAccess alone only proves read/use access.
    if (!(await isProjectAdmin(user.id, projectId))) {
      return NextResponse.json(
        {
          success: false,
          error: "Only the board owner or a project admin can add members",
        },
        { status: 403 }
      );
    }

    const parsedBody = await readJsonBody<{ userToAdd?: unknown }>(request)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body
    const target = resolveMcpAddMemberTarget(body.userToAdd);

    if (target.kind === "invalid") {
      return NextResponse.json(
        {
          success: false,
          error: target.reason,
          details: { field: "userToAdd", code: "invalid_type" },
        },
        { status: 400 }
      );
    }

    if (target.kind === "agent") {
      const result = await addAgentToBoard(projectId, target.agentId, ctx.user.id);

      if (!result.ok) {
        return NextResponse.json(
          {
            success: false,
            error: result.message,
          },
          { status: result.status }
        );
      }

      return NextResponse.json(
        {
          success: true,
          projectId,
          status: "added",
          agent: {
            id: result.member.agent.id,
            displayName: result.member.agent.displayName,
          },
        },
        { status: 200 }
      );
    }

    if (target.kind === "user_id") {
      // HTPR-6408: numeric IDs are direct adds. Email invites stay consent-based.
      const result = await addExistingUserToProject(projectId, target.userId);
      if (!result.ok) {
        return NextResponse.json(
          {
            success: false,
            error: result.message,
          },
          { status: result.status }
        );
      }
      return NextResponse.json(
        mcpAddedMemberResponse(projectId, result.outcome, result.member),
        { status: 200 }
      );
    }

    const emailToAdd = target.email;
    const existingEmailUser = await prisma.user.findFirst({
      where: { email: emailToAdd },
      select: { id: true, displayName: true, email: true },
    });
    const existingEmailMember = existingEmailUser
      ? await prisma.member.findFirst({
          where: {
            projectId,
            userId: existingEmailUser.id,
            agentId: null,
          },
          select: { id: true },
        })
      : null;

    const result = await addMemberController(ctx.user.id, projectId, [emailToAdd]);

    if (result.status !== 200) {
      return NextResponse.json(
        {
          success: false,
          error: result.json,
        },
        { status: result.status }
      );
    }

    const pendingInvite = await prisma.invite.findFirst({
      where: {
        projectId,
        expired: false,
        emails: { has: emailToAdd },
      },
      orderBy: { invitedAt: "desc" },
      select: { id: true },
    });

    if (pendingInvite) {
      return NextResponse.json(
        mcpPendingInviteResponse(projectId, pendingInvite.id),
        { status: 200 }
      );
    }

    // Email belonged to an existing team member; addMemberController added them.
    if (existingEmailUser) {
      const member =
        existingEmailMember ??
        (await prisma.member.findFirst({
          where: { projectId, userId: existingEmailUser.id, agentId: null },
          select: { id: true },
        }));
      if (member) {
        return NextResponse.json(
          mcpAddedMemberResponse(
            projectId,
            existingEmailMember ? "already_member" : "added",
            {
              id: member.id,
              userId: existingEmailUser.id,
              displayName: existingEmailUser.displayName,
              email: existingEmailUser.email,
            },
          ),
          { status: 200 }
        );
      }
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "Invite did not create a pending invite or add the user as a member",
      },
      { status: 500 }
    );
  } catch (err) {
    console.error("[MCP Add Project Member] Error:", err);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
