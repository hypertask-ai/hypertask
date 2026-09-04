import { NextRequest } from "next/server";

import {
  clearFigmaConnectionVersion,
  getFigmaAuthenticatedUser,
  noStore,
  trustedMutationOrigin,
} from "@/app/api/figma/_lib";
import {
  disconnectFigmaUser,
  figmaConnectEnabledFor,
  getFigmaConnection,
} from "@/lib/figma/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  const principal = await getFigmaAuthenticatedUser(request);
  if (principal.status === "unauthorized") {
    return noStore({ error: "Unauthorized" }, 401);
  }
  if (principal.status === "error") {
    return noStore({ error: "Figma connection is unavailable" }, 503);
  }
  if (!trustedMutationOrigin(request)) {
    return noStore({ error: "Forbidden" }, 403);
  }

  try {
    const connection = await getFigmaConnection(principal.userId);
    if (!connection && !(await figmaConnectEnabledFor(principal.userId))) {
      return noStore({ error: "Not found" }, 404);
    }

    await disconnectFigmaUser(principal.userId);
    const response = noStore({ success: true });
    clearFigmaConnectionVersion(response);
    return response;
  } catch (error) {
    console.error("Figma disconnect failed", error);
    return noStore({ error: "Could not disconnect Figma" }, 500);
  }
}
