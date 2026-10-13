"use server"


import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";


export const getAllSubTasks = async (taskId: number) => {
  const session = await getSessionUser(await headers());
  if (!session) return;
  const projectAccess = projectContentAccessWhere(session.userId);
  let allTasks: number[] = [];

  const getTask = async (taskId: number) => {
    try {
      const task = await prisma.task.findFirst({
        where: { id: taskId, project: projectAccess },
        select: {
          id:true,
          subTasks: {
            where: { project: projectAccess },
            select: { id: true },
            orderBy: {
              status: "desc",
            },
          },
        }
      });
      if (!task)return
      allTasks.push(task.id);
      if (task?.subTasks && task.subTasks.length > 0) {
        for (const subTask of task.subTasks) {
          await getTask(subTask.id);
        }
      }
    } catch (error) {
      console.log("🚀 ~ getAllSubTasks ~ error:", error);
    }
  };

  try {
    await getTask(taskId);
    if (!allTasks.length) return;

    return allTasks;
  } catch (error) {
    console.log("🚀 ~ getAllSubTasks ~ error:", error)
  }
};
