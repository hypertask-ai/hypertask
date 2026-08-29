// Import PrismaClient from the generated Prisma client


import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import prisma from "@/lib/prisma";


// Example usage
const fetchUrls = async (taskId:string | string[], commentId?:string) => {
  
        try {
            if (!taskId) {
                return ({
                    status:400,
                    json:{ message: "User id is required" }
                })
                // return res.status(400).json({ message: "User id is required" });
            }
            if (!commentId){
                const urls = await prisma.url.findMany({
                    where: {
                        TaskId: parseInt(taskId as string)
                    },
                })
                return ({
                    status:200,
                    json:urls.reverse()
                })
            }
            else{

                // ================= focus on description
                if (commentId===descriptionContainerId){
                    const allUrls: any = await prisma.$queryRaw`
                    SELECT *
                    FROM "Url"
                    WHERE "TaskId" = ${parseInt(taskId as string)} 
                    ORDER BY 
                        CASE WHEN "commentId" IS NULL THEN 0
                            WHEN "commentId" = ${parseInt(commentId as string)} THEN 0
                            ELSE 1
                        END,
                        "id" DESC;
                `;

                    return ({
                        status:200,
                        json:allUrls
                    })
                }

                // ================= focus on comments
                else{
                    const allUrls: any = await prisma.$queryRaw`
                    SELECT *
                    FROM "Url"
                    WHERE "TaskId" = ${parseInt(taskId as string)} 
                    ORDER BY 
                        CASE WHEN "commentId" IS NULL AND ${parseInt(commentId as string)} = -1 THEN 0
                            WHEN "commentId" = ${parseInt(commentId as string)} THEN 0
                            ELSE 1
                        END,
                        "id" DESC;
                `;
                
                return ({
                    status:200,
                    json:allUrls
                })  
                }
            
            }
   
            // return res.status(200).json(comments);
            // console.log(comments);
        } catch (error) {
            console.log(error);
            return ({
                status:500,
                json:{ message: "Internal server error", error:error }
            })
            // return res.status(500).json({ message: "Internal server error" });
        }
   
}

// Run the main function
export default fetchUrls;