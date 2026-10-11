// Import PrismaClient from the generated Prisma client


// Create an instance of PrismaClient
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";


// Example usage
const sectionGetByTask= async (taskId:number, userId:number) => {
  try {
    // Get Task First
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
    // return res.status(200).json(sections);
    // Get field names of the "Section" model
    
  } catch (error) {
    console.error('Error:', error);
    return({
      status:200,
      json:{error:error}
    })
  }
}


// Run the main function
export default sectionGetByTask;