"use server"
import { cookies } from "next/headers"

import { taskWriterRoute } from "@/lib/constants/APIRouteConstants"
import { getInviteFromProjectId } from "@/utils/api/invite/generatePublicInviteController"
import prisma from "../prisma"
import { requireActionUser } from "./actionUser"
import { teamAiSettingsViewerWhere } from "@/utils/controllers/teams/getTeamAiSettingsForViewer"
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes"
import {
  uploadAttachmentToAICustomInstruction as uploadAttachment,
  type TUploadToAICustomInstruction,
  type TReturnAIRAGUpload,
} from "./uploadAttachmentToAICustomInstruction"


export const getTeamById = async (teamId: string) => {
  const viewer = await requireActionUser()
  const team = await prisma.team.findFirst({
    where: teamAiSettingsViewerWhere(viewer, undefined, teamId),
    include: {
      team_activity: true
    }
  },)
  return team
}
export const getTeamInviteUrl = async (userId: number, teamId: string | undefined) => {
  userId = await requireActionUser(userId)
  if (!teamId) return "Error"

  const team = await prisma.team.findUnique({ where: { id: teamId } })
  if (!team) return "Error"

  const projectFirst = await prisma.project.findFirst({
    where: {
      status: "Normal",
      teamId: team.id,

      OR: [
        {
          ownerId: userId,
        },
        {
          members: {
            some: {
              userId,
              agentId: null,
            }
          }
        }
      ]
    },

    orderBy: { createdAt: "asc" }
  })
  if (!projectFirst) return "Error"
  const inviteURL = await getInviteFromProjectId(projectFirst.id, userId)
  return { inviteURL: inviteURL, projectFirst }
}


export const updateUserSettingOnboarding = async (userId: number, state: boolean) => {
  userId = await requireActionUser(userId)
  const userSetting = await prisma.userSetting.update({
    where: {
      userId
    },
    data: {
      onboardingTourStatus: state,
      onboardingTutorialStatus: true
    }
  })
  return userSetting
}

export const updateUserSettingTutorial = async (userId: number, state: boolean) => {
  userId = await requireActionUser(userId)
  const userSetting = await prisma.userSetting.update({
    where: {
      userId
    },
    data: {
      onboardingTutorialStatus: state,
      onboardingTourStatus: state
    }
  })
  return userSetting
}

export const updateUserSettingTrial = async (userId: number, state: boolean) => {
  userId = await requireActionUser(userId)
  const userSetting = await prisma.userSetting.update({
    where: {
      userId
    },
    data: {
      trialStatus: state
    }
  })
  return userSetting
}




export const checkIfUserIsNew = async (userId: number) => {
  userId = await requireActionUser(userId)
  const teamsOwned = await prisma.team.count({
    where: {
      googleAccount: {
        userId
      }
    }
  })
  const membersInTeam = await prisma.member_Team.count({
    where: {
      userId
    }
  })

  return teamsOwned === 0 && membersInTeam === 0
}

export async function taskWriterFetch(prompt: string) {
  await requireActionUser()
  const isNativeTaskWriter = taskWriterRoute.startsWith("/")
  const baseUrl =
    process.env.NEXT_PUBLIC_BASEURL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000")
  const cookieHeader = isNativeTaskWriter ? (await cookies()).toString() : ""

  const response = await fetch(isNativeTaskWriter ? `${baseUrl}${taskWriterRoute}` : taskWriterRoute, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({
      projectId: 15,
      teamId: "08f79efd-770e-4e32-9728-65e6d29ec893",
      PROMPT: prompt,
    }),
  });

  if (!response.ok) {
    throw new Error(`Error: ${response.statusText}`);
  }

  else return response
}

export const uploadAttachmentToAICustomInstruction = async (props: TUploadToAICustomInstruction): Promise<TReturnAIRAGUpload> => {
  const viewer = await requireActionUser()
  const instruction = await prisma.aI_Custom_Instructions.findFirst({
    where: { id: props.AI_Custom_Instructions_id, project: getProjectWhere(viewer) },
    select: { id: true },
  })
  if (!instruction) throw new Error("Forbidden")
  return uploadAttachment(props)
}
