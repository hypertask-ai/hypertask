import { NextResponse } from "next/server";
import type { TaskWriteResponse } from "@/lib/api/task-writes/route";

export function notificationWriteJson(body: unknown, status: number): TaskWriteResponse {
  if (status !== 304) {
    return body === undefined ? new NextResponse(null, { status }) : NextResponse.json(body, { status });
  }
  // Pages accepts JSON with 304 and strips the body only at the HTTP boundary.
  const text = JSON.stringify(body);
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => text ?? "",
    json: async () => text === undefined ? undefined : JSON.parse(text),
  };
}
