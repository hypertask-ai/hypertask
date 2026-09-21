"use server"
import { env as appEnv } from "#env";
import { logger as htLogger } from "#logger";
import { cookies } from "next/headers"

import { taskWriterRoute } from "@/lib/constants/APIRouteConstants"
import { getInviteFromProjectId } from "@/utils/api/invite/generatePublicInviteController"
import prisma from "../prisma"
import { IAttachment } from "@/models/model"


export const getTeamById = async (teamId: string) => {
  const team = await prisma.team.findUnique({
    where: {
      id: teamId
    },
    include: {
      team_activity: true
    }
  },)
  return team
}
export const getTeamInviteUrl = async (userId: number, teamId: string) => {

  const team = await prisma.team.findUnique({ where: { id: teamId } })
  if (!team) return "Error"
  htLogger.info("🚀 ~ getTeamInviteUrl ~ team:", team)

  const projectFirst = await prisma.project.findFirst({
    where: {
      // teamId:team?.id,
      // ownerId:userId,
      status: "Normal",
      teamId: team.id,

      // make sure we're at least member or owner of that board in the team
      OR: [
        {
          ownerId: userId,
        },
        {
          members: {
            some: {
              userId
            }
          }
        }
      ]
    },

    orderBy: { createdAt: "asc" }
  })
  htLogger.info("🚀 ~ getFIrstTeam ~ projectFirst:", projectFirst)
  if (!projectFirst) return "Error"
  const inviteURL = await getInviteFromProjectId(projectFirst.id, userId)
  htLogger.info("🚀 ~ getTeamInviteUrl ~ inviteURL:", inviteURL)
  return { inviteURL: inviteURL, projectFirst }
}


export const updateUserSettingOnboarding = async (userId: number, state: boolean) => {
  const userSetting = await prisma.userSetting.update({
    where: {
      userId
    },
    data: {
      onboardingTourStatus: state,
      onboardingTutorialStatus: true
    }
  })
  htLogger.info("🚀 ~ updateUserSettingOnboarding ~ userSetting:", userSetting)
  return userSetting
}

export const updateUserSettingTutorial = async (userId: number, state: boolean) => {
  const userSetting = await prisma.userSetting.update({
    where: {
      userId
    },
    data: {
      onboardingTutorialStatus: state,
      onboardingTourStatus: state
    }
  })
  htLogger.info("🚀 ~ updateUserSettingTutorial ~ userSetting:", userSetting)
  return userSetting
}

export const updateUserSettingTrial = async (userId: number, state: boolean) => {
  const userSetting = await prisma.userSetting.update({
    where: {
      userId
    },
    data: {
      trialStatus: state
    }
  })
  htLogger.info("🚀 ~ updateUserSettingTutorial ~ userSetting:", userSetting)
  return userSetting
}




export const checkIfUserIsNew = async (userId: number) => {
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

  // meaning the user isnt a member or owns any team.
  return teamsOwned === 0 && membersInTeam === 0
}

// utils/taskWriter.js
export async function taskWriterFetch(prompt: string) {
  const isNativeTaskWriter = taskWriterRoute.startsWith("/")
  const baseUrl =
    appEnv.NEXT_PUBLIC_BASEURL ||
    appEnv.NEXT_PUBLIC_SITE_URL ||
    (appEnv.VERCEL_URL
      ? `https://${appEnv.VERCEL_URL}`
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

  // Handle the response
  if (!response.ok) {
    throw new Error(`Error: ${response.statusText}`);
  }

  else return response
}




type TUploadToAICustomInstruction = {
  AI_Custom_Instructions_id: number;
  S3URL: string;
  type: string;
  name: string;
  fileSize:number

}
type TReturnAIRAGUpload = {
  status:number;
  text:string;
  data:IAttachment | unknown
}
export const uploadAttachmentToAICustomInstruction = async (props: TUploadToAICustomInstruction): Promise<TReturnAIRAGUpload> => {
  const { AI_Custom_Instructions_id, S3URL, type, name, fileSize } = props
  try {
    const attachment_ = await prisma.attachment.create({
      data: {
        fileType: type ?? "",
        fileSource: S3URL,
        fileName: name ?? "",
        fileSize: String(fileSize),
        AI_Custom_Instructions_id,
      }
    });
    return {
      status:200,
      data:attachment_,
      text:'success',
    }
  } catch (error) {
    htLogger.info("🚀 ~ uploadAttachmentToAICustomInstruction ~ error:", error)
    return {
      status:500,
      data:error,
      text:'error'
    }
  }
}
