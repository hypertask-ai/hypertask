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
          const clients = await tx.$queryRaw<
            Array<{ client_id: string; owner_id: number | null }>
          >`
            SELECT "client_id", "owner_id"
            FROM "OAuthClient"
            WHERE "client_id" = ${clientId}
            FOR UPDATE
          `;
          if (
            clients.length !== 1 ||
            clients[0].owner_id !== session.userId
          ) {
            throw new ClientNotOwnedError();
          }

          const authorizationCodes = await tx.$queryRaw<
            Array<{ user_id: number }>
          >`
            SELECT "user_id"
            FROM "OAuthAuthorizationCode"
            WHERE "client_id" = ${clientId}
            FOR UPDATE
          `;
          const refreshTokens = await tx.$queryRaw<
            Array<{
              userId: number;
              accessTokenJti: string;
              accessTokenExpiresAt: Date;
            }>
          >`
            SELECT "userId", "accessTokenJti", "accessTokenExpiresAt"
            FROM "OAuthRefreshToken"
            WHERE "clientId" = ${clientId}
            FOR UPDATE
          `;

          const hasOtherOwner =
            authorizationCodes.some(
              (code) => code.user_id !== session.userId,
            ) ||
            refreshTokens.some((token) => token.userId !== session.userId);
          if (hasOtherOwner) throw new ClientNotOwnedError();

          const now = new Date();
          for (const token of refreshTokens) {
            if (token.accessTokenExpiresAt <= now) continue;
            await tx.revokedToken.upsert({
              where: { jti: token.accessTokenJti },
              create: {
                jti: token.accessTokenJti,
                user_id: session.userId,
                revoked_at: now,
                expires_at: token.accessTokenExpiresAt,
              },
              update: { revoked_at: now },
            });
          }
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
