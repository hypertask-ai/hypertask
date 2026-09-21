// Assuming you have already initialized Prisma and have access to the PrismaClient instance.

import prisma from "@/lib/prisma";
import getFirst from "./getFirst";
import isProjectAdmin from "./isProjectAdmin";



const archiveProject = async(projectId:number, userId:number) =>{
  // Check if the request is a POST request

    try {

      if (!userId || !projectId) 
        return ({
          status:400,
          json:{message:"Missing Required Data"}
        })

      const project = await prisma.project.findUnique({
        where:{
            id:projectId
        }
      })
        
      if (!project || !(await isProjectAdmin(userId, projectId))){
        return ({
            status:401,
            json:{message:"Only Board owner or admin can archive this board."}
          })
      }

    //   Now that we are sure that the person making the request is indeed the owner,
    //   we can move on with the code

    // ==================================== FIRST ARCHIVE ALL THE NOTIFICATIONS. 
    console.log ("--------------------------- Arhciving all the notifications ---------------------")
    await prisma.notification.updateMany({
        where:{
            projectId:projectId
        },
        data:{
            status:"Archive"
        }
    })
    console.log ("================= notifications Archived. =================")


    console.log ("--------------------------- Arhciving THE ACTUAL PROJECT ---------------------")

    if (project.status==="Normal"){

      const updated_project = await prisma.project.update({
          where:{
              id:project.id
          },
          data:{
              status:"Archive"
          }
      })
      await prisma.favorites.deleteMany({
        where:{
          projectId: project.id,
        }
      })
      const firstProject = await getFirst(userId)
      console.log("🚀 ~ file: archiveProject.ts:55 ~ archiveProject ~ updated_project:", updated_project)
      return ({
        status:200,
        json:{message:"Success", firstProject: firstProject.json}
      })
      
    }
    else{
      const updated_project = await prisma.project.update({
        where:{
            id:project.id
        },
        data:{
            status:"Normal"
        }
    })
    console.log("🚀 ~ file: archiveProject.ts:55 ~ archiveProject ~ updated_project:", updated_project)
  
    }

    
      return ({
        status:200,
        json:{message:"Success"}
      })

    } catch (error) {
      console.error(error);
      return ({
        status:500,
        json:{ error: 'Failed to add new section' }
      })
    }

}

export default archiveProject
