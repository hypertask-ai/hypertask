import { NextRequest } from "next/server";

import { getFigmaRequestUser, noStore } from "@/app/api/figma/_lib";
import { getFigmaConnection } from "@/lib/figma/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const principal = await getFigmaRequestUser(request);
  if (principal.status === "unauthorized") {
    return noStore({ error: "Unauthorized" }, 401);
  }
  if (principal.status === "disabled") {
    return noStore({ error: "Not found" }, 404);
  }
  if (principal.status === "error") {
    return noStore({ error: "Figma connection is unavailable" }, 503);
  }

  try {
    return noStore({ connection: await getFigmaConnection(principal.userId) });
  } catch (error) {
    console.error("Figma connection read failed", error);
    return noStore({ error: "Figma connection is unavailable" }, 500);
  }
}
