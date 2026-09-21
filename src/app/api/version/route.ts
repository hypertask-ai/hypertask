import { env as appEnv } from "#env";
import { withoutAuth } from "#with-auth";
import { NextResponse } from "next/server";

// Returns this deployment's build id. An open tab polls it to detect when a
// newer version is live and reload itself (deploy-skew guard, HTPR-4574).
// Public, no auth, no secrets: it only echoes the same id that is already
// inlined into the client bundle via next.config's NEXT_PUBLIC_BUILD_ID.
export const dynamic = "force-dynamic";

async function GETHandler() {
  return NextResponse.json(
    { buildId: appEnv.NEXT_PUBLIC_BUILD_ID ?? "dev" },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export const GET = withoutAuth(GETHandler);
