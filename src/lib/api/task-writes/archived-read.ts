import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRequest, type TaskWriteRoute } from "./route";
import { taskReadQuery } from "./read-query";
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

const route = taskWriteRoute({
  schema: z.custom<NonNullable<TaskWriteRequest["query"]>>(() => true),
  validationMessage: "Missing required field",
  allowNullBody: true,
  operation: async (query, session) => {
    const userId = session.userId;
    try {
      const { projectId, cursor, mode, boardScope: rawBoardScope, q } = query;
      const parsedProjectId = parseOptionalInt(projectId);
      const parsedCursor = parseOptionalInt(cursor);
      const boardScope = parseBoardScope(rawBoardScope);
      const parsedQuery = parseOptionalQuery(q);
      const response = mode === "meta"
        ? await tasksGetArchivedTasksMeta(userId, parsedProjectId, boardScope)
        : await tasksGetArchivedTasks(
            userId,
            parsedCursor,
            parsedProjectId,
            boardScope,
            parsedQuery,
          );
      return NextResponse.json(response.json, { status: response.status });
    } catch (error) {
      console.log(error);
      return NextResponse.json([], { status: 200 });
    }
  },
});

export const GET: TaskWriteRoute = async (request, session) => {
  return route({ headers: request.headers, json: async () => taskReadQuery(request) }, session);
};
