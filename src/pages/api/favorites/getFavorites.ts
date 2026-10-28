import { logDesktopCliResponse } from "@/lib/auth/desktopCliTokenUser";
import { NextApiHandler } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { getFavoritesForUser } from "@/utils/controllers/favorites/getAll";

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

  try {
    return res.status(200).json(await getFavoritesForUser(session.userId));
  } catch (error) {
    console.log(error);
    return res.status(400).json({ message: "Unable to load favorites" });
  }
};

export default handler;
