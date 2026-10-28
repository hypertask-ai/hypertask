import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAppShellBootstrap } from "@/lib/appShellBootstrap/server";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
};

export async function POST() {
  const session = await getSessionUser(await headers());
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", code: "SESSION_REQUIRED" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const payload = await getAppShellBootstrap(session.userId);
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Unable to load app shell" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
