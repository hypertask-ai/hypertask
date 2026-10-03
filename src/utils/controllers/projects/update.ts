import { SortingMode } from "@prisma/client";

import prisma from "@/lib/prisma";
import { updateTaskSingle } from "../tasks/single";
import { IUser } from "@/models/model";
import { taskWriteAccessWhere } from "./getAllIncludes";


const updateProject= async (projectId:number, title:unknown,sorting_mode:SortingMode | undefined, uniqueIdentifier:string|null|undefined, currentUser: IUser, agentId?: string | null) => {
        try {
            const trimmedTitle = typeof title === "string" ? title.trim() : "";
            if (!Number.isSafeInteger(projectId) || projectId <= 0 || !trimmedTitle || trimmedTitle.length > 200) {
                return ({
                    status:400,
                    json:{ message: "projectId must be a positive integer and title must be between 1 and 200 characters" }
                })
            }
            const exists = await prisma.project.findFirst({
                where: { id: projectId, status: { not: "Deleted" } },
                select: { id: true }
            });
            if (!exists) {
                return { status: 404, json: { message: "Board not found" } };
            }
            const accessWhere = taskWriteAccessWhere(currentUser.id, agentId);
            const allowed = await prisma.project.findFirst({
                where: { id: projectId, status: { not: "Deleted" }, ...accessWhere },
                select: { id: true }
            });
            if (!allowed) {
                return { status: 403, json: { message: "Not allowed to rename this board" } };
            }
            // A board identifier must never be blanked out: an empty value renders every task
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
                    id: projectId,
                    status: { not: "Deleted" },
                    ...accessWhere
                },
                data: {
                    title:trimmedTitle,
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
            if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") {
                return { status: 403, json: { message: "Not allowed to rename this board" } };
            }
            console.log(error);
            return ({
                status:400,
                json:{ message: JSON.stringify(error) }
            })
        }
};

export default updateProject;
