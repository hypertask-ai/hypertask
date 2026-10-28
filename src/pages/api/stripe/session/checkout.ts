import { logDesktopCliResponse } from "@/lib/auth/desktopCliTokenUser";
import { NextApiRequest, NextApiResponse } from "next";
import { GUEST_FORBIDDEN_MESSAGE, isGuestRequest } from "@/lib/demo/guestGuard";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { createAuthorizedCheckoutSession } from "@/utils/controllers/stripe/createAuthorizedCheckoutSession";

export default async function checkoutsSessionHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  logDesktopCliResponse(session, req, res);
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  if ("agentId" in session && session.agentId) {
    return res.status(403).json({ message: "Only human team owners can update billing" });
  }

  if (req.body?.intent === "signup-straight-to-board" && session.source !== "cli-bearer") {
    const baseUrl = process.env.NEXT_PUBLIC_BASEURL || process.env.NEXT_PUBLIC_APP_URL;
    let appOrigin: string;
    try {
      appOrigin = new URL(baseUrl ?? "").origin;
    } catch {
      return res.status(503).json({ message: "Checkout origin configuration is unavailable" });
    }
    if (req.headers.origin !== appOrigin) {
      return res.status(403).json({ message: "Invalid checkout origin" });
    }
  }

  if (await isGuestRequest(req)) {
    return res.status(403).json({ message: GUEST_FORBIDDEN_MESSAGE });
  }

  try {
    const result = await createAuthorizedCheckoutSession(session.userId, req.body);
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error(e, `Stripe Checkout error`);
    return res.status(500).json({ message: "Could not create checkout session" });
  }
}
