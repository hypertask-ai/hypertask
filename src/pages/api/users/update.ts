import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import update_or_create_user from "@/utils/controllers/users/update_or_create_user";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    // HTPR-4191: identity comes from the signed session, never the body.
    // Unauthenticated, this route minted fully verified users (isVerified
    // defaults to true in update_or_create_user) for any email a caller named.
    const session = verifySession(req.cookies[SESSION_COOKIE]);
    if (!session) {
      return res
        .status(401)
        .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
    }

    // session.email is optional on older sessions; the DB row is the identity.
    const sessionUser = await prisma.user.findUnique({
      where: { id: session.id },
      select: { email: true },
    });
    if (!sessionUser) {
      return res
        .status(401)
        .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
    }

    const update = await update_or_create_user(
      sessionUser.email,
      req.body.user,
      req.body.shouldSkipInteractive
    );

    return res.status(update.status).json(update.res);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export default handler;
