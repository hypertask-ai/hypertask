import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import prisma from "@/lib/prisma";

import {
  getHypertasksS3Client,
  HYPERTASKS_S3_BUCKET,
  parseHypertasksStorageKeyFromUrl,
} from "@/lib/storage/hypertasksS3";

const route = taskWriteRoute({
  schema: z.custom<Record<string, string | string[]>>(() => true),
  validationMessage: "File name is required",
  operation: async (query, session) => {
    const userId = session.userId;
    const s3 = getHypertasksS3Client();
    const { fileName, fileSource } = query;

    if (!fileSource || !fileName) {
      return new NextResponse("File name is required", { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
    }

    try {
      const fileSourceStr = fileSource.toString();

      // Look up the attachment record to verify project membership
      const attachment = await prisma.attachment.findFirst({
        where: { fileSource: fileSourceStr },
        select: {
          task: { select: { projectId: true } },
          description: { select: { task: { select: { projectId: true } } } },
          comment: { select: { task: { select: { projectId: true } } } },
          chatMessage: { select: { session: { select: { userId: true } } } },
        },
      });

      if (attachment) {
        // Determine the projectId through whichever relation is populated
        const projectId =
          attachment.task?.projectId ??
          attachment.description?.task?.projectId ??
          attachment.comment?.task?.projectId;

        if (attachment.chatMessage) {
          // Chat message attachment: only the session owner may download
          if (attachment.chatMessage.session.userId !== userId) {
            return new NextResponse("Forbidden", { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
          }
        } else if (projectId != null) {
          // Task/description/comment attachment: verify project membership
          const project = await prisma.project.findFirst({
            where: {
              id: projectId,
              OR: [
                { members: { some: { userId: userId } } },
                { ownerId: userId },
              ],
            },
            select: { id: true },
          });
          if (!project) {
            return new NextResponse("Forbidden", { status: 403, headers: { "content-type": "text/html; charset=utf-8" } });
          }
        }
        // If attachment exists but has no resolvable project/chatMessage (e.g. AI_Custom_Instructions),
        // allow authenticated users through
      }
      // If no attachment record found, allow authenticated users (legacy files)

      const key = getKey(fileSourceStr);
      const params = {
        Bucket: HYPERTASKS_S3_BUCKET,
        Key: key,
        Expires: 60, // URL expiration in seconds
        ResponseContentDisposition: `attachment; filename=${encodeURIComponent(fileName.toString())}`,
      };

      const downloadUrl = s3.getSignedUrl("getObject", params);

      return NextResponse.json({ downloadUrl }, { status: 200, headers: { "Cache-Control": "no-store", Pragma: "no-cache", Expires: "0" } });
    } catch (err) {
      console.error("Error fetching file from S3:", err);
      return new NextResponse("Error fetching file", { status: 500, headers: { "content-type": "text/html; charset=utf-8" } });
    }
  },
});

export const GET: TaskWriteRoute = async (request, session) => {
  let query = request.query;
  if (!query) {
    const params = new URL(request.url!).searchParams;
    query = Object.fromEntries([...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    }));
  }
  return route({ headers: request.headers, json: async () => query }, session);
};

const getKey = (url: string) => {
  const key = parseHypertasksStorageKeyFromUrl(url);
  if (!key) {
    throw "unknown link";
  }
  return key;
};
