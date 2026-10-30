import prisma from "@/lib/prisma";
import { TeamKeyOnlyRefusal } from "@/lib/ai/teamAiFunding";

type TurbopufferVectorRow<T> = T & { vector?: number[] | null };

async function embeddingTeamId(
  row: { teamId?: string; projectId?: number },
  projectTeams: Map<number, string | null>,
): Promise<string | null> {
  if (typeof row.teamId === "string" && row.teamId && row.teamId !== "__schema__") return row.teamId;
  if (typeof row.projectId !== "number" || row.projectId <= 0) return null;
  if (!projectTeams.has(row.projectId)) {
    const project = await prisma.project.findUnique({
      where: { id: row.projectId },
      select: { teamId: true },
    });
    projectTeams.set(row.projectId, project?.teamId ?? null);
  }
  return projectTeams.get(row.projectId) ?? null;
}

export async function embedRowsForWrite<T extends { searchText: string; teamId?: string; projectId?: number }>(
  rows: T[],
  context: string,
  embedTexts: (texts: string[], teamId?: string | null) => Promise<number[][]>,
): Promise<{ rows: Array<TurbopufferVectorRow<T>>; hasVectors: boolean }> {
  try {
    const projectTeams = new Map<number, string | null>();
    const groups = new Map<string, number[]>();
    const vectors: Array<number[] | null> = new Array(rows.length);
    for (let index = 0; index < rows.length; index += 1) {
      const teamId = await embeddingTeamId(rows[index], projectTeams);
      if (!teamId) {
        vectors[index] = null;
        continue;
      }
      const key = teamId;
      const indexes = groups.get(key) ?? [];
      indexes.push(index);
      groups.set(key, indexes);
    }
    for (const [teamId, indexes] of groups) {
      try {
        const embeddings = await embedTexts(indexes.map((index) => rows[index].searchText), teamId || null);
        indexes.forEach((rowIndex, embeddingIndex) => {
          vectors[rowIndex] = embeddings[embeddingIndex];
        });
      } catch (error) {
        if (!(error instanceof TeamKeyOnlyRefusal)) {
          console.error(`${context} embedding error:`, error);
          continue;
        }
        indexes.forEach((rowIndex) => {
          vectors[rowIndex] = null;
        });
      }
    }
    return {
      rows: rows.flatMap((row, index) => vectors[index] === undefined ? [] : [{ ...row, vector: vectors[index] }]),
      hasVectors: vectors.some((vector) => vector !== undefined),
    };
  } catch (error) {
    console.error(
      `${context} embedding error, upserting without vectors:`,
      error
    );
    return { rows, hasVectors: false };
  }
}

