

import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";


const sectionGetByTask= async (taskId:number, userId:number) => {
  try {
    const task = await prisma.task.findFirst({
        where: {
            id: taskId,
            project: projectContentAccessWhere(userId),
        },
        include: {
            project: true,
            user: true,
        }
    })
    if (!task) {
      return { status: 404, json: { message: "Task not found" } };
    }
    const sections = await prisma.section.findMany({
        where:{
            projectId:task?.projectId,
            deleted:false,
        },
        orderBy:{
          ranking:"asc"
        }

    });
    return({
      status:200,
      json:sections
    })
  } catch (error) {
    console.error('Error:', error);
    return({
      status:200,
      json:{error:error}
    })
  }
}


export default sectionGetByTask;