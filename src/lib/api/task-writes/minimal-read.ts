import { NextResponse } from "next/server";
import type { TaskWriteRoute } from "./route";
import prisma from "@/lib/prisma";

// Keep this reader's legacy unauthenticated contract.
export const READ: TaskWriteRoute = async (request) => {
  try {
    const body = await request.json();
    const { id } = body;
    if (!id) {
      return NextResponse.json({ message: "Missing required field" }, { status: 400 });
    }
    const response = await prisma.task.findUnique({ where: { id } });
    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.log({ error });
    return NextResponse.json({ message: "Internal server error" + JSON.stringify(error) }, { status: 500 });
  }
};
