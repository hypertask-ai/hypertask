import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute } from "@/lib/api/task-writes/route";
import { loadSessionUserRecord } from "@/lib/auth/sessionUserRecord";
import * as sectionService from "@/utils/controllers/section/sectionService";
import getProjectView from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { broadcastBoardChange } from "@/lib/realtime/server";

export const POST = taskWriteRoute({
  schema: z.custom<Record<string, any>>(() => true),
  validationMessage: "Missing projectId or title",
  allowNullBody: true,
  prepare: session => loadSessionUserRecord(session.userId),
  operation: async (body, user) => {
    const req = { body };
    try {
      const { projectId, title, ranking, after_section_id } = req.body;
      if (!projectId || !title) return NextResponse.json({ message: "Missing projectId or title" }, { status: 400 });

      const projectIdNum = typeof projectId === "string" ? parseInt(projectId, 10) : projectId;
      const afterSectionIdNum = after_section_id != null
        ? (typeof after_section_id === "string" ? parseInt(after_section_id, 10) : after_section_id)
        : undefined;
      const response = await sectionService.createSection({
        projectId,
        title,
        ranking,
        afterSectionId: afterSectionIdNum,
        userId: user.id,
      });
      if (response.status !== 200) {
        return NextResponse.json(response.json, { status: response.status });
      }
      const project_view_updated = await getProjectView(projectIdNum, user.id);
      void broadcastBoardChange(projectIdNum, { originUserId: user.id });
      return NextResponse.json({
        message: "Section created successfully",
        section: response.json,
        project_view: project_view_updated,
      }, { status: 200 });
    } catch (error) {
      console.log("Error creating section:", error);
      return NextResponse.json({ message: "Internal Server Error" }, { status: 500 });
    }
  },
});
