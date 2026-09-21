import { NextApiHandler } from "next";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { getFavoritesForUser } from "@/utils/controllers/favorites/getAll";

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

  try {
    return res.status(200).json(await getFavoritesForUser(session.id));
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: "Unable to load favorites" });
  }
};

export default handler;
