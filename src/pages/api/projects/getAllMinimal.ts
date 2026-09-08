import { NextApiHandler } from "next";
import getAllMinimal from "@/utils/controllers/projects/getAllMinimal";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

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

  const mode = req.query.mode as "ExtraMinimal" | "Calendar" | undefined;
  const response = await getAllMinimal(session.id, mode);
  return res.status(response.status).json(response.json);
};

export default handler;
