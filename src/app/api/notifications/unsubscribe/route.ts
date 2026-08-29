import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe";

// HTPR-4164: turns off notification email for whoever holds a validly-signed
// token. Deliberately NO auth: the whole point is a stop path for someone who
// cannot log in, and Gmail/Yahoo one-click POSTs this URL unattended with no
// cookies. The signature is the authorisation.
//
// GET so a human clicking the footer link lands somewhere, POST so providers can
// do the one-click handshake. Both do the same thing.
export const dynamic = "force-dynamic";

async function unsubscribe(request: NextRequest) {
  const claim = verifyUnsubscribeToken(
    request.nextUrl.searchParams.get("token")
  );
  if (!claim) {
    return { ok: false as const, message: "This unsubscribe link is not valid." };
  }

  // The email is signed into the token, but it is the user row that decides
  // where mail goes. Re-check they still match, so a token for an address the
  // account has since moved away from cannot silence the new one.
  const user = await prisma.user.findUnique({
    where: { id: claim.userId },
    select: { id: true, email: true },
  });
  if (!user || (user.email ?? "").trim().toLowerCase() !== claim.email) {
    return { ok: false as const, message: "This unsubscribe link is no longer valid." };
  }

  // notification=false is the master switch every send already checks;
  // notificationPreference=nothing keeps the in-app settings UI consistent with
  // what actually happens.
  await prisma.userSetting.updateMany({
    where: { userId: user.id },
    data: { notification: false, notificationPreference: "nothing" },
  });

  return {
    ok: true as const,
    message: "You will not get notification emails from Hypertask any more.",
  };
}

function page(message: string, ok: boolean): string {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? "Unsubscribed" : "Link not valid"} • Hypertask</title>
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
       display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;
       background:#fff;color:#111}
  main{max-width:34rem;text-align:center}
  h1{font-size:1.25rem;margin:0 0 .5rem}
  p{font-size:.9375rem;line-height:1.5;color:#444;margin:0 0 1.5rem}
  a{color:#111}
  @media (prefers-color-scheme:dark){
    body{background:#0a0a0a;color:#fafafa} p{color:#a1a1a1} a{color:#fafafa}
  }
</style>
<main>
  <h1>${ok ? "Unsubscribed" : "Link not valid"}</h1>
  <p>${message}</p>
  <p><a href="https://app.hypertask.ai/">Go to Hypertask</a></p>
</main>`;
}

export async function GET(request: NextRequest) {
  const result = await unsubscribe(request);
  return new NextResponse(page(result.message, result.ok), {
    status: result.ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  // One-click: providers want a 2xx and ignore the body.
  const result = await unsubscribe(request);
  return NextResponse.json(
    { success: result.ok, message: result.message },
    { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } }
  );
}
