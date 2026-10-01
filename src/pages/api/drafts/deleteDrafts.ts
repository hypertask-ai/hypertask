import deleteDrafts from "@/utils/controllers/drafts/deleteDrafts";
import { NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    const { taskId, draftType } = req.body;
    try {
      const response = await deleteDrafts(taskId, userId, draftType);
      return res.status(response.status).json(response.json);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Failed to add new section" });
    }
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }
}
