import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  checkMcpRateLimit,
  createUnauthorizedResponse,
  validateManagementOrSessionAuth,
} from "@/lib/mcp/auth";
import {
  InvalidAccountMcpTokenError,
  mintAccountMcpToken,
  revokeAccountMcpToken,
} from "@/lib/mcp/accountTokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mintTokenSchema = z
  .object({
    expires_in_days: z.number().int().min(1).max(365).default(30),
  })
  .strict();

const revokeTokenSchema = z
  .object({
    token: z.string().trim().min(1).max(8192).optional(),
    revoke_all: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.token) !== Boolean(value.revoke_all), {
    message: "Provide exactly one of token or revoke_all=true",
  });

export async function POST(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  const ctx = await validateManagementOrSessionAuth(request, "write");
  if (!ctx) return createUnauthorizedResponse();

  try {
    const input = mintTokenSchema.parse(await request.json());
    return NextResponse.json(
      mintAccountMcpToken(ctx.user, input.expires_in_days),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid request", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("[Admin Tokens] Failed to mint token:", error);
    return NextResponse.json(
      { success: false, error: "Failed to mint token" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  const ctx = await validateManagementOrSessionAuth(request, "write");
  if (!ctx) return createUnauthorizedResponse();

  try {
    const input = revokeTokenSchema.parse(await request.json());
    return NextResponse.json(
      await revokeAccountMcpToken(ctx.user.id, input),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid request", issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof InvalidAccountMcpTokenError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 },
      );
    }
    console.error("[Admin Tokens] Failed to revoke token:", error);
    return NextResponse.json(
      { success: false, error: "Failed to revoke token" },
      { status: 500 },
    );
  }
}
