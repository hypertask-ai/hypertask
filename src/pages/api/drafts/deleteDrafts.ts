import deleteDrafts from "@/utils/controllers/drafts/deleteDrafts";
import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "POST") {
    const { taskId, draftType } = req.body;
    const user = JSON.parse(req.cookies.nookies_user!);
    try {
      const response = await deleteDrafts(taskId, user.id, draftType);
      return res.status(response.status).json(response.json);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Failed to add new section" });
    }
  } else {
    return res.status(405).json({ error: "Method not allowed" });
  }
}
