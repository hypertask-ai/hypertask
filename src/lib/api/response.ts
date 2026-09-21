import type { NextApiResponse } from "next";
import { NextResponse } from "next/server.js";

export type ApiSuccess<T> = { data: T };
export type ApiFailure = { error: string };

type PagesResponse = Pick<NextApiResponse, "status">;

export function apiOk<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data }, { status });
}

export function apiError(
  status: number,
  message: string,
  response?: PagesResponse,
): NextResponse<ApiFailure> | void {
  const body: ApiFailure = { error: message };
  if (response) {
    response.status(status).json(body);
    return;
  }
  return NextResponse.json(body, { status });
}
