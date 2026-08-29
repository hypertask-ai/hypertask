// Assuming you have already initialized Prisma and have access to the PrismaClient instance.

import prisma from "@/lib/prisma";



const getArchived = async(userId:number) =>{
  // Check if the request is a POST request

    try {
      if (!userId) 
        return ({
          status:400,
          json:{message:"Missing Required Data"}
        })
      // Find the project by ID and update the sections array
      const all_projects = await prisma.project.findMany({
        where:{
            ownerId:userId,
            status:"Archive"
        }
      })
      return ({
        status:200,
        json:all_projects
      })
    } catch (error) {
      console.error(error);
      return ({
        status:500,
        json:{ error: 'Failed to add new section' }
      })
    }

}

export default getArchived