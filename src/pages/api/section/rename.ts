import RenameSection from "@/utils/controllers/section/rename";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const { sectionId, newSection } = req.body;
    let currentUser;
    try {
      currentUser = req.cookies.nookies_user
        ? JSON.parse(req.cookies.nookies_user)
        : undefined;
    } catch {
      currentUser = undefined;
    }

    if (!currentUser?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!sectionId || !newSection) {
      return res.status(400).json({ message: "Missing Required Data" });
    }
    try {
      const response = await RenameSection(currentUser.id, sectionId, newSection);
      return res.status(response?.status).json(response?.json);
    } catch (error) {
      console.error("Error:", error);
    }
  }
};

export default handler;
