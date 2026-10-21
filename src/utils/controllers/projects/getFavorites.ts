
import prisma from "@/lib/prisma";



const getFavorites = async(userId:number) =>{
    try {
      if (!userId) 
        return ({
          status:400,
          json:{message:"Missing Required Data"}
        })
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

export default getFavorites