import { NextResponse } from "next/server";
import { NODE_SECURITY_FLOOR, meetsNodeSecurityFloor } from "@/lib/runtime/nodeSecurityFloor";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
      node: {
        securityFloor: NODE_SECURITY_FLOOR,
        meetsSecurityFloor: meetsNodeSecurityFloor(process.version),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
