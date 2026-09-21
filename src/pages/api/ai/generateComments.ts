// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { IComment } from '@/models/model';
import { ITaskArchiveActivity, ITaskAssignedActivity, ITaskEstimateActivity, ITaskLabelActivity, ITaskMoveActivity, ITaskPriorityActivity } from '@/models/ActivityModels.ts';
import { extractTipTapContent } from '@/utils/helperFunctions/multiPages';
import { getReactionMetadata } from '@/utils/controllers/ai/task/generateCommentsController';
import { buildTaskPayloadForAI } from '@/utils/controllers/ai/task/buildTaskPayloadForAI';



export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {

  try {

    const { taskId, commentIds } = req.body;
    if (!taskId) return res.status(400).json({ message: "Missing task id" })
    const result = await generateCommentsHandler(taskId, commentIds ?? []);
    if (!result) {
      return res.status(404).json({ message: "Task not found" });
    }
    const { task, response } = result;
    // console.log("🚀 ~ task:", task)
    // console.log("🚀 ~ response:", response)
    return res.status(200).json({ task, comments: response })
  } catch (error) {
    console.log(error)
    return res.status(500).json(error)
  }
}
export const generateCommentsHandler = async (taskId: number, commentIds: number[]) => {
  const taskFromDB = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      user: true,
      title: true,
      ticketNumber: true,
      uniqueIndex:true,
      status: true,
      project: { select: { title: true, team: true } },
      description: true,
      description_: { select: { content: true } },
      archivedAt: true,
      updatedAt: true,
      createdAt: true,
      dueDate: true,
      projectId: true,
      userId: true,
      section: true,
      sectionId: true,
      parentTaskId: true,
      totalComments: true,
      assignees: {
        select: {
          userId: true,
          user: {
            select: {
              displayName: true
            }
          }
        }
      },
      followers: {
        select: {
          userId: true,
          user: {
            select: {
              displayName: true
            }
          }
        }
      }
      ,
      priority: {
        select: {
          priority_index: true,
          Priority_Value: true
        }
      },
      estimate: {
        select: {
          estimate_index: true,
          estimate_value: true
        }
      },
      taskLabels: {
        select: {
          labelId: true,
          label: {
            select: {
              value: true
            }
          }
        }
      },
      subTasks: {
        select: {
          id: true,
          uniqueIndex: true
        }
      },
      relatedFromTasks: {
        select: {
          targetTaskId: true,
          sourceTaskId: true
        }
      },

    }
  })
  if (!taskFromDB) return 
  // const task = {
  //   ...task_,
  //   teamId: task_?.project.team?.id,
  //   projectId: task_?.projectId,
  //   description: task_?.description_?.content.replaceAll(/\"/g, "'") ?? task_?.description ?? "",
  //   description_: "",
  // }
  const body = buildTaskPayloadForAI(taskFromDB)
  const comments = await getComments(taskId, commentIds)
  const response = comments.map((comment) => {
    let comment_text = '';
    let comment_created_by;
    if (comment.activity) {
      comment_text = getActivityText((comment as any)) ?? ""
      comment_created_by = "Activity Log"
    }
    else {
      comment_created_by =
        comment.agent?.displayName ||
        comment.agentDisplayName ||
        comment.creator?.displayName;
      comment_text = comment.text ?? '';
    }
    const { mentions, src } = extractTipTapContent(comment_text);    
    return {
      comment_id: comment.id,
      commentId: comment.id,
      created_at: comment.createdAt,
      comment_text: comment_text,
      text:comment_text,
      comment_creator: comment_created_by,
      comment_type: !!comment.activity,
      src,
      mentions,
      taskId: comment.taskId,
      creatorId: comment.creatorId??-1,
      projectId: taskFromDB.projectId,
      taskUniqueIndex: taskFromDB.uniqueIndex
      // reactionData
    }
  })

  return { task:body, response }

}
async function getComments(taskId: number, commentIdsToGet: number[]) {

  if (commentIdsToGet.length === 0) {
    const comments = await prisma.comment.findMany({
      where: { taskId },
      orderBy: {
        createdAt: "desc"
      },
      include: {
        creator: true,
        agent: { select: { displayName: true } },
        reactions: {
          where: { isDeleted: false },
          select: {
            id: true,
            unified: true,
            emoji: true,
            names: true,
            userId: true,
            isDeleted: true,
            createdAt: true,
            taskId: true
          }
        },
      },
    })
    return comments
  }
  else {
    const comments = await prisma.comment.findMany({
      where: { taskId, id: { in: commentIdsToGet } },
      orderBy: {
        createdAt: "desc"
      },
      include: {
        creator: true,
        agent: { select: { displayName: true } },
        reactions: {
          where: { isDeleted: false },
          select: {
            id: true,
            unified: true,
            emoji: true,
            names: true,
            userId: true,
            isDeleted: true,
            createdAt: true,
            taskId: true
          }
        },
      }
    })
    return comments
  }
}

const getActivityText = (comment: IComment) => {
  const activity = comment.activity
  if (!activity) return
  var text_to_return = "";
  switch (activity?.type) {
    case "TaskArchive":
      text_to_return = generateTextForTaskArchived(activity);
      break;
    case "TaskEstimate":
      text_to_return = generateTextForTaskEstimateActivity(activity);
      break;
    case "TaskAssigned":
      text_to_return = generateTextForTaskAssignedActivity(activity);
      break;
    case "TaskLabel":
      text_to_return = generateTextForTaskLabelActivity(activity);
      break;
    case "TaskMove":
      text_to_return = generateTextForTaskMove(activity)
      break;
    case "TaskPriority":
      text_to_return = generateTextForTaskPriority(activity);
      break;
    default:
      break;
  }
  return text_to_return ?? ""
}


const generateTextForTaskMove = (activity: ITaskMoveActivity) => {
  return `${activity.data.fromUser?.displayName ?? ""} changed the status from  ${activity?.data.fromSection?.sectionTitle} to ${activity?.data.toSection?.sectionTitle}`;
}

const generateTextForTaskArchived = (activity: ITaskArchiveActivity) => {
  const archivebody = activity?.data.newStatus === "Archive" ? "archived" : "unarchived"
  return `${activity.data.fromUser?.displayName ?? ""} ${archivebody}  the task`
}

const generateTextForTaskPriority = (activity: ITaskPriorityActivity) => {
  const user = `${activity.data.fromUser?.displayName ?? ""}`
  if (activity.data.toPriority?.priority_index === 0) {
    return `${user} set the priority as none.`
  }
  else if (activity.data.fromPriority?.priority === undefined) {
    return `${user}  prioritized this task to ${activity?.data.toPriority?.Priority_Value}`
  }
  else {
    return `${user} updated the priority from ${activity?.data.fromPriority.Priority_Value} to ${activity?.data.toPriority?.Priority_Value}`
  }

}


const generateTextForTaskLabelActivity = (activity: ITaskLabelActivity) => {
  // if priority was created, from would be missing
  const user = `${activity.data.fromUser?.displayName ?? ""}`
  const label = `${activity?.data.toLabel.label?.value}`
  if (activity.status === "Created") {
    return `${user} created label ${label} and added it to this task.`
  }

  else if (activity.status === "Assigned") {
    return `${user} assigned label ${label} to this task.`

  }

  // --------------- label removed 
  else return `${user} removed label ${label} from this task.`

}

const generateTextForTaskAssignedActivity = (activity: ITaskAssignedActivity) => {
  const fromUser = `${activity.data.fromUser?.displayName ?? ""}`
  const toUser = `${activity.data.toUser.displayName}`
  // --------------- if self dealing with the task
  if (activity.data.toUser.userId === activity.data.fromUser.userId) {

    // for unassignment
    if (activity.data.updatedStatus === "Unassigned") {
      return `${fromUser} unassigned themself from this task.`
    }

    // for assignmend
    else {
      return `${fromUser} assigned themself from this task.`
    }
  }

  // ---------------- if different user interacting with different user
  else {
    // for unassignment
    if (activity.data.updatedStatus === "Unassigned") {
      return `${fromUser} unassigned ${toUser}.`

    }
    else {
      return `${fromUser} assigned ${toUser}.`

    }
  }
}


const generateTextForTaskEstimateActivity = (activity: ITaskEstimateActivity) => {
  // if priority was created, from would be missing
  const user = activity.data.fromUser?.displayName ?? ""
  const toEstimate = activity?.data.toEstimate.estimate_value
  const fromEstimate = activity?.data.fromEstimate?.estimate_value
  if (!activity.data.fromEstimate?.estimate) {
    return `${user}  set task size as ${toEstimate}`
  }

  else return `${user} updated the task size from ${fromEstimate} to ${toEstimate}`
}

export const getTaskPayloadForFAST = async (taskId: number) => {
    const taskFromDB = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      user: true,
      project: { select: { title: true, team: true } },
      description_: { select: { content: true } },
      assignees: {
        select: {
          userId: true,
          user: {
            select: {
              displayName: true
            }
          }
        }
      },
      followers: {
        select: {
          userId: true,
          user: {
            select: {
              displayName: true
            }
          }
        }
      },
      priority: {
        select: {
          priority_index: true,
          Priority_Value: true
        }
      },
      estimate: {
        select: {
          estimate_index: true,
          estimate_value: true
        }
      },
      taskLabels: {
        select: {
          labelId: true,
          label: {
            select: {
              value: true
            }
          }
        }
      },
      relatedFromTasks: true,
      subTasks: true,
      parentTask: true,
    }
  })
  if (!taskFromDB) return 

  const body = buildTaskPayloadForAI(taskFromDB)
  return body
}
