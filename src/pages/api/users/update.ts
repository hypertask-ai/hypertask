import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import update_or_create_user from "@/utils/controllers/users/update_or_create_user";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const session = verifySession(req.cookies[SESSION_COOKIE]);
    if (!session) {
      return res
        .status(401)
        .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
    }

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
