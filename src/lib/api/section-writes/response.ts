import { NextResponse } from "next/server";
import type { TaskWriteResponse } from "@/lib/api/task-writes/route";

export function sectionWriteJson(body: unknown, status: number): TaskWriteResponse {
  if (status !== 204) {
    return body === undefined ? new NextResponse(null, { status }) : NextResponse.json(body, { status });
  }
  // Pages accepts a JSON body with 204 and strips it only at the HTTP boundary.
  const text = JSON.stringify(body);
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => text ?? "",
    json: async () => text === undefined ? undefined : JSON.parse(text),
  };
}
