import { NextApiHandler } from "next";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import getUserById from "@/utils/controllers/users/getById";

const handler: NextApiHandler = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = verifySession(req.cookies[SESSION_COOKIE]);
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  const response = await getUserById(session.id);
  return res.status(response.status).json(response.res);
};

export default handler;
