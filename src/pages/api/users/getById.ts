import { logDesktopCliResponse } from "@/lib/auth/desktopCliTokenUser";
import { NextApiHandler } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import getUserById from "@/utils/controllers/users/getById";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getSessionUser(new Headers(req.headers as Record<string, string>));
  logDesktopCliResponse(session, req, res);
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  const response = await getUserById(session.userId);
  return res.status(response.status).json(response.res);
};

export default handler;
