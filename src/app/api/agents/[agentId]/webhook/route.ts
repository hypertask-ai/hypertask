import { logger as htLogger } from "#logger";
import { getAuthSession, withAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import {
  AgentWebhookInputError,
  manageAgentWebhook,
  upsertAgentWebhook,
} from "@/lib/agentWebhooks/management";

async function currentUserId(request: NextRequest): Promise<number | null> {
  const session = await getAuthSession(request.headers);
  return session?.userId ?? null;
}

function hasTrustedMutationOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function inputError(error: unknown) {
  if (error instanceof AgentWebhookInputError) {
    return NextResponse.json(
      { success: false, error: error.message, field: error.field },
      { status: error.status },
    );
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }
  htLogger.error("[agent-webhook] management error", error);
  return NextResponse.json(
    { success: false, error: "Internal server error" },
    { status: 500 },
  );
}

async function GETHandler(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  try {
    const userId = await currentUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    const { agentId } = await props.params;
    return NextResponse.json(
      await manageAgentWebhook({ userId, agentId, action: "get" }),
    );
  } catch (error) {
    return inputError(error);
  }
}

async function PUTHandler(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  try {
    const userId = await currentUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    if (!hasTrustedMutationOrigin(request)) {
      return NextResponse.json(
        { success: false, error: "Invalid request origin" },
        { status: 403 },
      );
    }
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new AgentWebhookInputError("Request body must be a JSON object");
    }
    const { agentId } = await props.params;
    const result = await upsertAgentWebhook({
      userId,
      agentId,
      body: body as Record<string, unknown>,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return inputError(error);
  }
}

async function DELETEHandler(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  try {
    const userId = await currentUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    if (!hasTrustedMutationOrigin(request)) {
      return NextResponse.json(
        { success: false, error: "Invalid request origin" },
        { status: 403 },
      );
    }
    const { agentId } = await props.params;
    return NextResponse.json(
      await manageAgentWebhook({ userId, agentId, action: "delete" }),
    );
  } catch (error) {
    return inputError(error);
  }
}

async function POSTHandler(
  request: NextRequest,
  props: { params: Promise<{ agentId: string }> },
) {
  try {
    const userId = await currentUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    if (!hasTrustedMutationOrigin(request)) {
      return NextResponse.json(
        { success: false, error: "Invalid request origin" },
        { status: 403 },
      );
    }
    const { agentId } = await props.params;
    const body = (await request.json()) as {
      action?: unknown;
      deliveryId?: unknown;
    };
    const action = body.action ?? "replay";
    if (action !== "test" && action !== "replay") {
      throw new AgentWebhookInputError(
        "action must be test or replay",
        "action",
      );
    }
    const result = await manageAgentWebhook({
      userId,
      agentId,
      action,
      deliveryId: body.deliveryId,
    });
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return inputError(error);
  }
}

export const GET = withAuth(GETHandler, { authenticateInHandler: true });
export const PUT = withAuth(PUTHandler, { authenticateInHandler: true });
export const DELETE = withAuth(DELETEHandler, { authenticateInHandler: true });
export const POST = withAuth(POSTHandler, { authenticateInHandler: true });
