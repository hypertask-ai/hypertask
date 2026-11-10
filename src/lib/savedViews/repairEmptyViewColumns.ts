import type { ISection } from "@/models/model";
import prisma from "@/lib/prisma";
import { boardColumnsForProject } from "@/utils/controllers/section/viewHelpers";

export const EMPTY_VIEW_COLUMNS_BATCH = 200;

type EmptyViewRow = {
  id: string;
  title: string | null;
  projectId: number;
  board: string;
};

export type RepairedBoard = {
  projectId: number;
  board: string;
  views: string[];
};

export type EmptyViewColumnRepair = {
  viewsFound: number;
  viewsRepaired: number;
  boards: RepairedBoard[];
  boardsWithoutColumns: number;
  truncated: boolean;
};

const viewTitle = (row: EmptyViewRow) => row.title?.trim() || "Untitled view";

export async function findViewsWithoutColumns(limit = EMPTY_VIEW_COLUMNS_BATCH): Promise<EmptyViewRow[]> {
  return prisma.$queryRaw<EmptyViewRow[]>`
    SELECT v."id" AS "id", v."title" AS "title", pv."projectId" AS "projectId", COALESCE(p."title", p."name") AS "board"
    FROM "View" v
    JOIN "Project_View" pv ON pv."id" = v."project_view_id"
    JOIN "Project" p ON p."id" = pv."projectId"
    WHERE p."status" = 'Normal'
      AND NOT EXISTS (SELECT 1 FROM "User_Project_View" upv WHERE upv."unsavedViewId" = v."id")
      AND (v."board_columns_view" IS NULL OR jsonb_typeof(v."board_columns_view") <> 'array' OR jsonb_array_length(v."board_columns_view") = 0)
    ORDER BY pv."projectId" ASC, v."createdAt" ASC
    LIMIT ${limit}
  `;
}

async function fillViewColumns(viewId: string, columns: ISection[]): Promise<boolean> {
  const filled = await prisma.$executeRaw`
    UPDATE "View" SET "board_columns_view" = CAST(${JSON.stringify(columns)} AS jsonb)
    WHERE "id" = ${viewId}
      AND ("board_columns_view" IS NULL OR jsonb_typeof("board_columns_view") <> 'array' OR jsonb_array_length("board_columns_view") = 0)
  `;
  return filled === 1;
}

export async function repairEmptyViewColumns(limit = EMPTY_VIEW_COLUMNS_BATCH): Promise<EmptyViewColumnRepair> {
  const found = await findViewsWithoutColumns(limit);
  const byBoard = new Map<number, EmptyViewRow[]>();
  for (const row of found) byBoard.set(row.projectId, [...(byBoard.get(row.projectId) ?? []), row]);

  const boards: RepairedBoard[] = [];
  let viewsRepaired = 0;
  let boardsWithoutColumns = 0;

  for (const [projectId, rows] of byBoard) {
    const columns = await boardColumnsForProject(projectId);
    if (columns.length === 0) {
      boardsWithoutColumns += 1;
      continue;
    }
    const repaired: string[] = [];
    for (const row of rows) {
      if (await fillViewColumns(row.id, columns)) {
        viewsRepaired += 1;
        repaired.push(viewTitle(row));
      }
    }
    if (repaired.length > 0) boards.push({ projectId, board: rows[0].board, views: repaired });
  }

  return { viewsFound: found.length, viewsRepaired, boards, boardsWithoutColumns, truncated: found.length === limit };
}
