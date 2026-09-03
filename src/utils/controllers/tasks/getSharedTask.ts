import prisma from "@/lib/prisma";
import { IComment } from "@/models/model";

export const getSharedComments = async (
  taskId: string | string[] | undefined
) => {
  try {
    const comments: any[] = await prisma.$queryRaw`
          SELECT
              c.id,
              c.text,
              c."taskId",
              c."creatorId",
              c."createdAt",
              c.activity,
              c."agentId",
              c."agentDisplayName",
  
          -- =========== reactions
          (
      SELECT JSONB_AGG(reaction_data)
      FROM (
          SELECT JSONB_BUILD_OBJECT(
              'emoji', r."emoji",
              'count', COUNT(r.id),
              'unified', r."unified",
              'users', JSONB_AGG(u.*)
          ) AS reaction_data
          FROM "Reaction" r
          JOIN "User" u ON r."userId" = u.id
          WHERE r."commentId" = c.id AND r."isDeleted" = false
          GROUP BY
              r."emoji",
              r."unified"
          ) reactions_subquery
          ) AS reactions,
  
          -- =========== attachments
          (
                  SELECT JSONB_AGG(a.*)
                  FROM "Attachment" a
                  WHERE a."commentId" = c.id
              ) as attachments,
  
          -- =========== creator
          COALESCE(to_jsonb(creator), 'null') AS creator,
          CASE WHEN agent.id IS NULL THEN 'null'::jsonb ELSE JSONB_BUILD_OBJECT(
              'id', agent.id,
              'displayName', agent."displayName",
              'photoURL', agent."photoURL"
          ) END AS agent
  
          FROM "Comment" c
          LEFT JOIN "User" creator ON c."creatorId" = creator."id"
          LEFT JOIN "Agent" agent ON c."agentId" = agent."id"
          
          WHERE "taskId" = ${parseInt(taskId as string)}
          GROUP BY
              c.id,
              c.text,
              c."taskId",
              c."creatorId",
              c."createdAt",
              c.activity,
              c."agentId",
              c."agentDisplayName",
              creator."id",
              agent."id"
          ORDER BY c."createdAt" ASC;
      `;
    return {
      status: 200,
      json: comments,
    };
  } catch (error) {
    console.log(error);
    return {
      status: 500,
      json: { message: "Internal server error" },
    };
  }
};

export const getSharedTaskInfo = async (shareId: string) => {
  const shared = await prisma.taskSharing.findFirst({
    where: {
      id: shareId,
    },
    include: {
      task: {
        include: {
          project: {
            include: {
              team: {
                include: {
                  googleAccount: true,
                },
              },
              ai_custom_instructions: true,
            },
          },
          user: true,
          description_: {
            include: {
              attachments: true,
            },
          },
          priority: true,
          estimate: true,
          Task_Summary: { take: 1, orderBy: { createdAt: "desc" } },
          subTasks: {
            where: {
              status: {
                not: "Deleted",
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
          parentTask: {
            include: {
              subTasks: { where: { status: { not: "Deleted" } } },
            },
          },
        },
      },
      user: true,
    },
  });

  return shared;
};

export const processSharedComments = (comments: IComment[]) => {
  const initialMap: any = {};
  comments.slice(0, -1).map((item: IComment, index: number) => {
    initialMap[index] = false;
  });

  return initialMap;
};

export const checkIfBoardMember = async (userId: number, projectId: number) => {
  try {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        status: "Normal",
      },
      include: {
        team: {
          include: {
            googleAccount: true,
            subscriptionPlan: {
              where: {
                subscriptionStatus: { not: "Expired" },
              },
            },
          },
        },
      },
    });

    if (!project) {
      return 400;
    }

    if (project.ownerId === userId) {
      return 200;
    }

    let member = await prisma.member.findFirst({
      where: {
        userId: userId,
        projectId: projectId,
      },
      include: {
        user: true,
      },
    });
    console.log(member);
    if (member) {
      return 200;
    }

    return 201;
  } catch (error) {
    console.log("🚀 ~ error:", error);
    return 400;
  }
};
