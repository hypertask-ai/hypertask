
import prisma from "@/lib/prisma";


const getTrashByProjectId = async ({ projectId, userId }: { projectId: number; userId: number }) => {
    try {
            if (!projectId || !userId) {
                return ({
                    status:400,
                    json:{ message: "Required information missing" }
                })
            }
            const project = await prisma.project.findUnique({
                where: {
                    id: projectId,
                    status:{not:"Deleted"},
                },
                include:{
                    tasks:{
                        where:{
                            status:"Deleted"
                        },
                        include:{
                            priority:true,
                            estimate:true,
                            user:true
                        },
                        orderBy:{
                            deletedAt:"desc",
                        }
                    }
                },
            })
            return project
        } catch (error) {
            console.log(error);

        }
};

export default getTrashByProjectId;