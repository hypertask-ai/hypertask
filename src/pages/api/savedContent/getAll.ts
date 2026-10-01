import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getAllStarred } from "@/utils/controllers/savedContent/getAllStarred";
import { getAllPinned } from "@/utils/controllers/savedContent/getAllPinned";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  try {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;

    const { pinned } = req.body;

    let response: any;
    if (pinned) response = await getAllPinned(userId);
    else response = await getAllStarred(userId);
    res.status(response.status).json(response.json);
  } catch (error) {
    console.log("🚀 ~ error:", error);
    return res.status(400).json({ message: JSON.stringify(error) });
  }
};

export default handler;
