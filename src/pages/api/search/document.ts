import { httpStatusConfig } from "@/lib/configs/http-status.config";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { searchDocuments } from "@/utils/controllers/search/searchDocuments";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

const handler: NextApiHandler = async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method === "POST") {
    try {
      const { searchQuery, projectIds, archive, contextProjectId } = req.body;
      const normalizedSearchQuery =
        typeof searchQuery === "string" ? searchQuery.trim() : "";
      const requestedProjectIds = Array.isArray(projectIds)
        ? Array.from(
            new Set(
              projectIds.filter(
                (projectId): projectId is number =>
                  Number.isInteger(projectId) && projectId > 0,
              ),
            ),
          )
        : [];

      if (!normalizedSearchQuery || requestedProjectIds.length === 0) {
        return res.status(400).json("Missing Required Data");
      }

      const session = await getSessionUser(
        new Headers(req.headers as Record<string, string>),
      );
      if (!session) {
        return res
          .status(401)
          .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
      }

      const { status, json } = await searchDocuments(session.userId, normalizedSearchQuery, requestedProjectIds, archive, contextProjectId);
      return res.status(status).json(json);
    } catch (error) {
      console.log("🤔 ~ handler ~ error:", error);
      return res
        .status(500)
        .json(httpStatusConfig.statusCodes[500].userMessage);
    }
  } else {
    return res.status(405).json(httpStatusConfig.statusCodes[405].userMessage);
  }
};

export default handler;
