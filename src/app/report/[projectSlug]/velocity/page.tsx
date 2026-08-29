import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireServerCookieUser } from "@/lib/auth/serverUser";
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
    return { title: "Velocity · Hypertask" };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { title: true, name: true },
  });

  return {
    title: `Velocity · ${project?.title ?? project?.name ?? "Hypertask"}`,
  };
}

export default async function Page({ params }: PageProps) {
  const user: IUser = await requireServerCookieUser();
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
