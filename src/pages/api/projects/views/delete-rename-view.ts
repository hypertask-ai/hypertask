// route = "/api/projects/views/delete-rename-view"
import prisma from "@/lib/prisma";
import { broadcastBoardChange } from "@/lib/realtime/server";
import getProjectView, { getUniqueSlug } from "@/utils/controllers/projects/views/viewsHelperAPIfunctions";
import { sanitizeViewBoardFilters } from "@/utils/helperFunctions/Views/BoardFilterSanitizer";
import {
    acquireBoardFilterWriteLock,
    assertViewIsNotManagedSmartSplit,
    ManagedSmartSplitMutationError,
} from "@/utils/controllers/projects/views/boardFilterWriteLock";
import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

// ============= simple stuff here
// 1. user selects the default view.
// 2. so that means the applied view in user_project_view is now null.
// 3. LITERALLY THATS IT
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    const currentUser = JSON.parse(req.cookies.nookies_user ?? "{}")

    if (req.method === "POST") {
        // lets check if the api request misses info like user, projectid.

        const { viewId, title } = req.body

        try {
            if (!viewId || !currentUser) return res.status(101).json({ message: "Missing required information" })
            if (title.length < 2) throw ("Title length too low!")
            const viewToUpdate = await prisma.view.findUnique({
                    where:{ id: viewId },
                    select:{
                        id: true,
                        project_view_id: true,
                        project_view: { select: { projectId: true } }
                    }})
            if (!viewToUpdate) throw new Error("View does not exist")
            const newSlug = await getUniqueSlug(viewToUpdate?.project_view_id, title)
            const viewProjectId = viewToUpdate.project_view.projectId
            const updatedView = await prisma.$transaction(async (tx) => {
              await acquireBoardFilterWriteLock(tx, viewProjectId)
              await assertViewIsNotManagedSmartSplit(tx, viewProjectId, viewId)
              return tx.view.update({
                where: { id: viewId },
                data: { title, slug: newSlug }
              })
            })
            const project_view_updated = await getProjectView(viewProjectId, currentUser.id)
            broadcastBoardChange(viewProjectId, { originUserId: currentUser.id })
            return res.status(200).json({view: newSlug === null ? undefined : sanitizeViewBoardFilters(updatedView), project_view_updated: project_view_updated});
        } catch (error) {
            console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
            if (error instanceof ManagedSmartSplitMutationError) {
                return res.status(error.status).json({ message: error.message })
            }
            return res.status(500).json(error)
        }
    }
    else if (req.method === "DELETE") {
        try {
            const { viewId } = req.query
            console.log("🤔 ~ handler ~ viewId:", viewId)
            const viewToDelete = await prisma.view.findUnique({
                where: { id: viewId as string },
                select: {
                    id: true,
                    project_view: { select: { id: true, projectId: true } }
                }
            })
            if (!viewToDelete) throw new Error("View does not exist")
            const project_View = viewToDelete.project_view
            const projectId_ = project_View.projectId
            await prisma.$transaction(async (tx) => {
                await acquireBoardFilterWriteLock(tx, projectId_)
                await assertViewIsNotManagedSmartSplit(tx, projectId_, viewToDelete.id)
                const user_Project_View = await tx.user_Project_View.findUnique({
                    where: {
                        user_project: {
                            userId: currentUser.id,
                            project_view_id: project_View.id
                        }
                    }
                })
                const unsavedViewId = user_Project_View?.unsavedViewId
                if (unsavedViewId && viewId === user_Project_View?.appliedViewId) {
                    console.log("🤔 ~ handler ~ unsavedViewId:", unsavedViewId)
                    await tx.view_Last_Used.deleteMany({where:{viewId: unsavedViewId as string}})
                    await tx.view.delete({ where: { id: unsavedViewId } })
                }
                const deleteViewLastUsed = await tx.view_Last_Used.deleteMany({where:{viewId: viewId as string}})
                console.log("🤔 ~ handler ~ deleteViewLastUsed:", deleteViewLastUsed)
                await tx.view.delete({where:{id:viewId as string}})
            })
            const promise2 = await getProjectView(projectId_, currentUser.id)
            broadcastBoardChange(projectId_, { originUserId: currentUser.id })

            return res.status(200).json(promise2)
        } catch (error) {
            console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
            if (error instanceof ManagedSmartSplitMutationError) {
                return res.status(error.status).json({ message: error.message })
            }
            return res.status(500).json(error)
        }
    }

};


export default handler
