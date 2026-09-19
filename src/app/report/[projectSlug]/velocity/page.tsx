import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireServerCookieUser } from "@/lib/auth/serverUser";
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- This server page enforces the report gate before loading board data.
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_6585_BOARD_REPORTS_FLAG } from "@/lib/flags/keys";
import prisma from "@/lib/prisma";
import type { IUser } from "@/models/model";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { parseProjectSlug } from "@/utils/controllers/taskDetail/load";
import VelocityReport from "./VelocityReport";

type PageProps = {
  params: Promise<{ projectSlug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { projectSlug } = await params;
  const projectId = parseProjectSlug(projectSlug);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return { title: "Board analytics · Hypertask" };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { title: true, name: true },
  });

  return {
    title: `Board analytics · ${project?.title ?? project?.name ?? "Hypertask"}`,
  };
}

export default async function Page({ params }: PageProps) {
  const user: IUser = await requireServerCookieUser();
  if (!(await isFeatureEnabled(HTPR_6585_BOARD_REPORTS_FLAG, user.id))) {
    redirect("/unauthorized");
  }

  const { projectSlug } = await params;
  const projectId = parseProjectSlug(projectSlug);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    redirect("/unauthorized");
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...getProjectWhere(user.id),
    },
    select: { title: true, name: true },
  });

  if (!project) {
    redirect("/unauthorized");
  }

  return (
    <VelocityReport
      boardName={project.title ?? project.name}
      currentUser={user}
      projectId={projectId}
    />
  );
}
