import { NextRequest, NextResponse } from "next/server";
import { validateMcpAuth, checkMcpRateLimit } from "@/lib/mcp/auth";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { getProjectMembers } from "@/utils/controllers/projects/getProjectMembers";
import prisma from "@/lib/prisma";
import { addMemberController } from "@/pages/api/invite/createInviteLink";
import { addAgentToBoard } from "@/utils/controllers/agents/boardMembers";
import { readJsonBody } from "@/lib/mcp/readJsonBody";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    const parsedBody = await readJsonBody<{ userToAdd?: unknown }>(request)
    if (!parsedBody.ok) return parsedBody.response
    const body = parsedBody.body
    const { userToAdd } = body;

    const isNonEmptyString = (val: any): val is string =>
      typeof val === "string" && val.trim().length > 0;

    const isPositiveInteger = (val: any): val is number =>
      typeof val === "number" && Number.isInteger(val) && val > 0;

    // Allow userToAdd to be either a valid email string, positive integer ID, or agent UUID
    if (
      !userToAdd ||
      !(
        (isNonEmptyString(userToAdd) &&
          (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userToAdd) ||
            UUID_PATTERN.test(userToAdd))) ||
        isPositiveInteger(userToAdd)
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "userToAdd must be a non-empty email string, a positive integer user ID, or an agent UUID",
          details: { field: "userToAdd", code: "invalid_type" },
        },
        { status: 400 }
      );
    }

    if (isNonEmptyString(userToAdd) && UUID_PATTERN.test(userToAdd)) {
      const result = await addAgentToBoard(projectId, userToAdd, ctx.user.id);

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
          agent: {
            id: result.member.agent.id,
            displayName: result.member.agent.displayName,
          },
        },
        { status: 200 }
      );
    }

    let emailToAdd: string | null = null;

    if (isNonEmptyString(userToAdd)) {
      // If userToAdd is a valid email string
      emailToAdd = userToAdd;
    } else if (isPositiveInteger(userToAdd)) {
      // If userToAdd is a positive integer, treat as user ID and look up the email
      const foundUser = await prisma.user.findUnique({
        where: { id: userToAdd },
        select: { email: true }
      });
      if (foundUser && typeof foundUser.email === "string" && foundUser.email.length > 0) {
        emailToAdd = foundUser.email;
      } else {
        return NextResponse.json(
          {
            success: false,
            error: "User ID does not exist or does not have a valid email",
            details: { field: "userToAdd", code: "user_not_found" }
          },
          { status: 404 }
        );
      }
    }

    if (!emailToAdd) {
      return NextResponse.json(
        {
          success: false,
          error: "Could not resolve a valid email address to add",
          details: { field: "userToAdd", code: "missing_email" },
        },
        { status: 400 }
      );
    }

    
    //Alright so this is where we are going to basically run the function to add a user to the project.
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

    return NextResponse.json(
      {
        success: true,
        projectId,
      },
      { status: 200 }
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
