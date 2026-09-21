import { NextApiRequest, NextApiResponse } from "next";
import { GUEST_FORBIDDEN_MESSAGE, isGuestRequest } from "@/lib/demo/guestGuard";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { createAuthorizedCheckoutSession } from "@/utils/controllers/stripe/createAuthorizedCheckoutSession";

export default async function checkoutsSessionHandler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = verifySession(req.cookies[SESSION_COOKIE]);
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  // HTPR-4303: anonymous demo guests must never reach Stripe.
  if (await isGuestRequest(req)) {
    return res.status(403).json({ message: GUEST_FORBIDDEN_MESSAGE });
  }

  try {
    const result = await createAuthorizedCheckoutSession(session.id, req.body);
    return res.status(result.status).json(result.body);
  } catch (e) {
    console.error(e, `Stripe Checkout error`);
    return res.status(500).json({ message: "Could not create checkout session" });
  }
}
