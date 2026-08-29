import { listRunning } from "@/lib/timeTracking";
import { NextRequest, NextResponse } from "next/server";
import { getTimeRequestUser } from "../_lib";

export async function GET(request: NextRequest) {
  const auth = await getTimeRequestUser(request);
  if (auth.response) return auth.response;

  const entries = await listRunning(auth.userId);
  return NextResponse.json({ success: true, entries });
}
