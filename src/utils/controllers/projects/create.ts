import { LogType, Status } from "@prisma/client";
import createLog from "../logs/createLog";
import { CreateLogInput } from "@/models/model";

import prisma from "@/lib/prisma";
import { getSequentialLetters } from "@/utils/helperFunctions/helperFunctions";
import { buildDefaultTitle } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { defaultFilterSettings } from "@/utils/helperFunctions/Views/FilterHelperFunctions";
import { FREE_BOARD_LIMIT_MESSAGE, isBoardLimitReached } from "./boardQuota";


const create = async (userId: number, title: string, teamId: string, googleAccountId: string) => {
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

    project = await prisma.project.create({
      data: {
        ownerId: userId,
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
    await updateUniqueIdentifier(teamId, title, project.id)

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
      json: { message: JSON.stringify(error) }
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
  // getSequentialLetters returns "Not enough characters" for very short titles — fall back to a
  // cleaned slug so a board ALWAYS gets a usable base. Every board MUST end up with a non-null
  // identifier; a null one renders task IDs as "-<n>".
  const raw = getSequentialLetters(title);
  const base = /^[A-Z0-9]{2,5}$/.test(raw)
    ? raw
    : ((title || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "BRD");

  // Ensure uniqueness within the team; on collision append a counter (kept <= 5 chars).
  let candidate = base;
  for (let i = 1; i <= 50; i++) {
    const clash = await prisma.project.findFirst({
      where: { teamId, uniqueIdentifier: candidate, status: { not: "Deleted" } },
    });
    if (!clash) break;
    candidate = (base.slice(0, 4) + i).slice(0, 5);
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { uniqueIdentifier: candidate },
  });
}
