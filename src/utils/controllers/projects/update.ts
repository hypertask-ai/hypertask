import { PrismaClient, SortingMode } from "@prisma/client";

import prisma from "@/lib/prisma";
import { updateTaskSingle } from "../tasks/single";
import { IUser } from "@/models/model";


const updateProject= async (projectId:number, title:string,sorting_mode:SortingMode, uniqueIdentifier:string|null, currentUser: IUser) => {
        // console.log("🚀 ~ updateProject ~ uniqueIdentifier:", uniqueIdentifier)
        try {
            if (!projectId || !title) {
                return ({
                    status:400,
                    json:{ message: "Required information missing" }
                })
            }
            // A board identifier must never be blanked out — an empty value renders every task
            // ID as "-<n>". Reject an explicit empty string; treat null/undefined as "leave unchanged".
            const trimmedIdentifier = typeof uniqueIdentifier === "string" ? uniqueIdentifier.trim() : uniqueIdentifier;
            if (trimmedIdentifier === "") {
                return ({
                    status:400,
                    json:{ message: "Board identifier cannot be empty" }
                })
            }
            const project = await prisma.project.update({
                where: {
                    id: projectId
                },
                data: {
                    title:title,
                    sorting_mode:sorting_mode,
                    uniqueIdentifier: trimmedIdentifier ?? undefined

                },
                include:{tasks:true}
            })
            // =================== RUNNING LOOP FOR EACH TASK
            if (trimmedIdentifier){
                for (const task of project.tasks){
                    // console.log("🚀 ~ task:", task)
                    await updateTaskSingle({id: task.id, ticketNumber:trimmedIdentifier.toUpperCase()+"-"+task.uniqueIndex}, currentUser)

                }
            }
            return ({
                status:200,
                json:project
            })
        } catch (error) {
            console.log(error);
            return ({
                status:400,
                json:{ message: JSON.stringify(error) }
            })
        }
};

export default updateProject;
