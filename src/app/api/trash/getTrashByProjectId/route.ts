import { NextResponse, type NextRequest } from "next/server";
import getTrashByProjectId from "@/utils/controllers/trash/getByProjectId";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { parsePositiveInt } from "@/lib/parsePositiveInt";

async function handler(request: NextRequest) {
  try {
    const session = await getSessionUser(request.headers);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const userId = session.userId;
    const projectId = parsePositiveInt(new URL(request.url).searchParams.get("projectId"));

    if (!projectId) return NextResponse.json({ message: "Missing Required information" }, { status: 400 });

    const response = await getTrashByProjectId({ projectId, userId });
    if (!response) return NextResponse.json({ message: "Project not found" }, { status: 404 });
    return NextResponse.json(response);
  } catch (error) {
    console.log(error);
    return NextResponse.json(error, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}
