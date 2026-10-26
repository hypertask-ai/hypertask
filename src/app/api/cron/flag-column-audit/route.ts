import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hasValidCronAuthorization } from "@/lib/cronAuthorization";
import { listFeatureFlagModes } from "@/lib/flags";
import { unreleasedTicketFlags } from "@/lib/flags/taskColumn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!hasValidCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [sections, flags] = await Promise.all([
    prisma.section.findMany({
      where: { projectId: 15, section_title: "Flag: Everyone", deleted: false },
      select: { id: true },
    }),
    listFeatureFlagModes(),
  ]);
  if (!sections.length) {
    return NextResponse.json({ error: "Flag: Everyone column not found" }, { status: 500 });
  }
  const tasks = await prisma.task.findMany({
    where: { projectId: 15, status: "Normal", sectionId: { in: sections.map(({ id }) => id) } },
    select: { uniqueIndex: true, description: true, description_: { select: { content: true } } },
  });
  const mismatches = tasks.flatMap((task) => {
    const blocked = unreleasedTicketFlags({ ...task, description: task.description_?.content ?? task.description }, flags);
    return blocked.length ? [{ ticket: `HTPR-${task.uniqueIndex}`, flags: blocked }] : [];
  });
  if (mismatches.length) console.error("[flag-column-audit] Unreleased tickets in Flag: Everyone", mismatches);
  return NextResponse.json({ checked: tasks.length, mismatches });
}
