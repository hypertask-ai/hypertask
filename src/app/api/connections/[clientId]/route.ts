import { NextRequest, NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth/getSessionUser";
import prisma from "@/lib/prisma";

const DELETE_ATTEMPTS = 3;

class ClientNotOwnedError extends Error {}

function hasTrustedMutationOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  )
    ?.split(",")[0]
    .trim();
  const protocol = (
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol
  )
    .split(",")[0]
    .trim()
    .replace(/:$/, "");
  if (!origin || !host || !protocol) return false;

  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

function notFoundResponse() {
  return NextResponse.json(
    { success: false, error: "Client not found" },
    { status: 404 },
  );
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ clientId: string }> },
) {
  try {
    const session = await getSessionUser(request.headers);
    if (!session) {
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

    const { clientId: rawClientId } = await props.params;
    const clientId = rawClientId?.trim();
    if (!clientId || clientId.length > 64) return notFoundResponse();

    for (let attempt = 0; attempt < DELETE_ATTEMPTS; attempt += 1) {
      try {
        await prisma.$transaction(async (tx) => {
          const clients = await tx.$queryRaw<Array<{ client_id: string }>>`
            SELECT "client_id"
            FROM "OAuthClient"
            WHERE "client_id" = ${clientId}
            FOR UPDATE
          `;
          if (clients.length !== 1) throw new ClientNotOwnedError();

          const authorizationCodes = await tx.$queryRaw<
            Array<{ user_id: number; used: boolean }>
          >`
            SELECT "user_id", "used"
            FROM "OAuthAuthorizationCode"
            WHERE "client_id" = ${clientId}
            FOR UPDATE
          `;
          const refreshTokens = await tx.$queryRaw<Array<{ userId: number }>>`
            SELECT "userId"
            FROM "OAuthRefreshToken"
            WHERE "clientId" = ${clientId}
            FOR UPDATE
          `;

          const ownsClient =
            authorizationCodes.some(
              (code) => code.user_id === session.userId && code.used,
            ) ||
            refreshTokens.some((token) => token.userId === session.userId);
          const hasOtherOwner =
            authorizationCodes.some(
              (code) => code.user_id !== session.userId,
            ) ||
            refreshTokens.some((token) => token.userId !== session.userId);
          if (!ownsClient || hasOtherOwner) throw new ClientNotOwnedError();

          // Legacy OAuth access tokens do not carry their client id, so the
          // account revocation timestamp is the only way to invalidate them.
          await tx.user.update({
            where: { id: session.userId },
            data: { mcpTokensRevokedAt: new Date() },
          });
          await tx.oAuthClient.delete({ where: { client_id: clientId } });
        });
        break;
      } catch (error) {
        if (error instanceof ClientNotOwnedError) throw error;
        if (
          (error as { code?: string })?.code !== "P2034" ||
          attempt === DELETE_ATTEMPTS - 1
        ) {
          throw error;
        }
      }
    }

    return NextResponse.json(
      { success: true, message: "Client removed" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ClientNotOwnedError) return notFoundResponse();
    console.error("Error removing OAuth client:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
