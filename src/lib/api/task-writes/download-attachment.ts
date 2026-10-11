import { NextResponse } from "next/server";
import { z } from "zod";
import { taskWriteRoute, type TaskWriteRoute } from "./route";
import { getAccessibleAttachmentKey } from "@/utils/controllers/tasks/getAccessibleAttachmentKey";

import {
  getHypertasksS3Client,
  HYPERTASKS_S3_BUCKET,
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

      const key = await getAccessibleAttachmentKey(fileSourceStr, userId);
      if (!key) {
        return new NextResponse("File not found", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
      }

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
