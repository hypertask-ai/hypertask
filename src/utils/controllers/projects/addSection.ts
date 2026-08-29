// Assuming you have already initialized Prisma and have access to the PrismaClient instance.

import prisma from "@/lib/prisma";



const addSection = async(currProjectID:number, newSectionTitle:string) =>{
  // Check if the request is a POST request

    try {
      if (!currProjectID || !newSectionTitle) 
        return ({
          status:400,
          json:{message:"Missing Required Data"}
        })
      // Find the project by ID and update the sections array
      const updatedProject = await prisma.project.update({
        where: { id: currProjectID },
        data: {
          sections: {
            push: newSectionTitle, 
          },
        },
      });
      return ({
        status:200,
        json:updatedProject
      })
    } catch (error) {
      console.error(error);
      return ({
        status:500,
        json:{ error: 'Failed to add new section' }
      })
    }

}

export default addSection