import { NextResponse } from "next/server";
import type { TaskWriteResponse } from "@/lib/api/task-writes/route";

export function viewWriteJson(body: unknown, status: number): TaskWriteResponse {
  if (status !== 101) {
    return body === undefined ? new NextResponse(null, { status }) : NextResponse.json(body, { status });
  }
  // Preserve the Pages contract without constructing an invalid Web Response.
  const text = JSON.stringify(body);
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}
