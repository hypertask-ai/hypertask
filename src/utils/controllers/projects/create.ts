import { LogType, Status } from "@prisma/client";
import createLog from "../logs/createLog";
import { CreateLogInput } from "@/models/model";

import prisma from "@/lib/prisma";
import { normalizeProjectPrefix, suggestProjectPrefix } from "@/lib/projectPrefix";
import { HTPR_6868_TICKET_PREFIX_FLAG, isFeatureEnabled } from "@/lib/flags";
import { buildDefaultTitle } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { defaultFilterSettings } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { FREE_BOARD_LIMIT_MESSAGE, isBoardLimitReached } from "./boardQuota";


const create = async (userId: number, title: string, teamId: string, googleAccountId: string, ticketPrefix?: unknown) => {
  try {
    if (!userId || !title || !teamId || !googleAccountId) {


      return ({
        status: 400,
        json: { message: "Required information missing" }
      })
      // return res.status(400).json({ message: "Required information missing" });
    }
    const user = await prisma.user.findUnique({
      where: {
        id: userId
      }
    })
    if (!user) {
      return ({
        status: 400,
        json: { message: "User not found" }
      })
      // return res.status(400).json({ message: "User not found" });
    }

    // HTPR-4894: free accounts cap out at FREE_BOARD_LIMIT owned boards.
    if (await isBoardLimitReached(userId)) {
      return ({
        status: 403,
        json: { message: FREE_BOARD_LIMIT_MESSAGE }
      })
    }

    let projectCount = Date.now() //temp count
    let project : any = undefined

    const hasPrefix = ticketPrefix !== undefined;
    if (hasPrefix && !(await isFeatureEnabled(HTPR_6868_TICKET_PREFIX_FLAG, userId))) {
      return { status: 403, json: { message: "Custom ticket prefixes are not enabled" } };
    }
    const prefix = hasPrefix ? normalizeProjectPrefix(ticketPrefix) : undefined;
    project = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${teamId}))`;
      if (prefix && await tx.project.findFirst({
        where: { teamId, uniqueIdentifier: { equals: prefix, mode: "insensitive" }, status: { not: "Deleted" } },
        select: { id: true },
      })) {
        throw new Error("Ticket prefix is already used by another board in this team");
      }
      return tx.project.create({
        data: {
          ownerId: userId,
          uniqueIdentifier: prefix,
          name: `project-${projectCount + 1}`,
          title: title,
          teamId: teamId,
          googleAccountId: googleAccountId,
          section: { // Add the section field with the related section records
            create: [
              { section_title: "Todo", ranking: "A0100" },
              { section_title: "Doing", ranking: "A0200" },
              { section_title: "Done", ranking: "A0300" },
            ],
          },
        },
      });
    });

    project = await prisma.project.update({
      where: { id: project.id },
      data: { name: `project-${project.id}` },
      include: {
        owner: true,
        team: {
          select: {
            title: true,
            stripe_customer_id: true,
            activeSubscriptionPlanId: true,
            compedUntil: true,
            compedPlan: true,
            subscriptionPlan: { select: { priceId: true } },
          },
        },
        tasks: {
          include: {
            assignees: {
              include: {
                user: true,
              },
            },
          },
        },
        section: true,
      },
    });
    createProjectViewAndCreateDefault({projectId:project.id, userId})
    if (!hasPrefix) {
      project.uniqueIdentifier = await updateUniqueIdentifier(teamId, title, project.id);
    }

    const createLogBody: CreateLogInput = {
      log: `${project.owner.displayName} created a board "${project.title}" in team "${project.team?.title}"`,
      type: LogType.Board,
      status: Status.Normal,
      LoggedById: userId
    }
    createLog(createLogBody)

    return ({
      status: 200,
      json: project
    })
  } catch (error) {
    console.log(error);
    return ({
      status: 400,
      json: { message: error instanceof Error ? error.message : "Unable to create board" }
    })
  }

};

export default create;

export async function createProjectViewAndCreateDefault(
  {
    userId,
    projectId
  }: {
    userId: number,
    projectId: number
  }
) {
  const project_view = await prisma.project_View.upsert({
    create: {
      // ... data to create a Project_View
      projectId
    },
    update: {
      // ... in case it already exists, update
    },
    where: {
      projectId
      // ... the filter for the Project_View we want to update
    },
    include:{
      project:{
        include:{
          section:{
            where:{
              deleted:false
            }
          }
        }
      }
    }
  })

  if (!project_view.default_view_id){
    console.log("🚀 ~ project_view had no default view, hence adding one")
    const currentDate= new Date()
    const view = await prisma.view.create({
      data: {
        title: buildDefaultTitle(projectId),
        project_view_id: project_view.id,
        userId,
        board_sorting_mode: "Manual",
        board_filters: defaultFilterSettings as any,
        board_columns_view: project_view.project.section,
        visibility:"Public",
        lastUsedAt: currentDate
      }
    })

    const lastviewused = await prisma.view_Last_Used.upsert({
      create:{
          userId:userId,
          viewId:view.id,
          lastUsedAt:currentDate
      },
      update:{
          lastUsedAt:currentDate
      },
      where:{
          user_view_last_used:{
              userId:userId,
              viewId:view.id,
          }
      }
  })

    await prisma.project_View.update({
      where:{
        projectId
      },
      data:{
        default_view_id:view.id
      }
    })
    console.log("🚀 ~ created === view:", view.title)

  }

  
}

export async function updateUniqueIdentifier(teamId: string, title: string, projectId: number) {
  const base = suggestProjectPrefix(title);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${teamId}))`;

    // Ensure uniqueness within the team; on collision append a counter (kept <= 5 chars).
    let candidate = base;
    let clash = await tx.project.findFirst({
      where: { teamId, uniqueIdentifier: { equals: candidate, mode: "insensitive" }, status: { not: "Deleted" } },
    });
    for (let i = 1; clash; i++) {
      const suffix = String(i);
      if (suffix.length >= 5) {
        throw new Error("Could not assign unique project identifier");
      }
      candidate = `${base.slice(0, 5 - suffix.length)}${suffix}`;
      clash = await tx.project.findFirst({
        where: { teamId, uniqueIdentifier: { equals: candidate, mode: "insensitive" }, status: { not: "Deleted" } },
      });
    }

    await tx.project.update({
      where: { id: projectId },
      data: { uniqueIdentifier: candidate },
    });
    return candidate;
  });
}
