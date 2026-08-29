import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import tasksGetArchivedTasks, {
    tasksGetArchivedTasksMeta,
} from "@/utils/controllers/tasks/getArchivedTasks";
import type { ArchiveBoardScope } from "@/store";

const parseBoardScope = (value: string | string[] | undefined): ArchiveBoardScope => {
    const scope = Array.isArray(value) ? value[0] : value;
    return scope === "active" || scope === "archived" || scope === "all"
        ? scope
        : "active";
};

const parseOptionalInt = (value: string | string[] | undefined) => {
    const parsed = parseInt(Array.isArray(value) ? value[0] : value ?? "");
    return Number.isFinite(parsed) ? parsed : undefined;
};

const parseOptionalQuery = (value: string | string[] | undefined) => {
    const query = (Array.isArray(value) ? value[0] : value)?.trim();
    return query || undefined;
};

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method === "GET") {
        try {
            // Derive the caller from the auth cookie, never from a query param:
            // /api is excluded from middleware, so trusting ?userId would let anyone
            // read another user's archived tasks by guessing an id.
            let user: { id?: number } | null = null;
            try {
                user = JSON.parse(req.cookies.nookies_user!);
            } catch {
                user = null;
            }
            if (!user?.id) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const { projectId, cursor, mode, boardScope: rawBoardScope, q } = req.query;
            const parsedProjectId = parseOptionalInt(projectId);
            const parsedCursor = parseOptionalInt(cursor);
            const boardScope = parseBoardScope(rawBoardScope);
            const parsedQuery = parseOptionalQuery(q);
            const response =
                mode === "meta"
                    ? await tasksGetArchivedTasksMeta(user.id, parsedProjectId, boardScope)
                    : await tasksGetArchivedTasks(
                        user.id,
                        parsedCursor,
                        parsedProjectId,
                        boardScope,
                        parsedQuery
                    );

           
            return res.status(response.status).json(response.json);
        } catch (error) {
            console.log(error);
            res.status(200).json([]);
        }
    } else {
        res.status(405).json({ message: "Method not allowed" });
    }
};

export default handler;
