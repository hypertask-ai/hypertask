import { withTaskWriteFlag } from "@/lib/api/task-writes/route";
import RenameSection from "@/utils/controllers/section/rename";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { getSessionUser } from "@/lib/auth/getSessionUser";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    const session = await getSessionUser(
      new Headers(req.headers as Record<string, string>)
    );
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = session.userId;
    const { sectionId, newSection } = req.body;

    if (!sectionId || !newSection) {
      return res.status(400).json({ message: "Missing Required Data" });
    }
    try {
      const response = await RenameSection(userId, sectionId, newSection);
      return res.status(response?.status).json(response?.json);
    } catch (error) {
      console.error("Error:", error);
    }
  }
};

export default withTaskWriteFlag(handler, "POST", async () =>
  (await import("@/lib/api/section-writes/rename")).POST
);
