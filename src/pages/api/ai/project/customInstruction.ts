import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { validateIntegerParam } from '@/utils/helperFunctions/multiPages';
import {
    defaultAiModelOption,
    getAiModelOptionById,
} from '@/lib/aiModelOptions';
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes';

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    if (req.method === "GET") {
        try {
            const currentUser = JSON.parse(req.cookies.nookies_user ?? "{}");
            const projectId = validateIntegerParam(req.query.projectId, 'projectId', res);

            if (!currentUser?.id) {
                return res.status(401).json({ message: "Missing user" });
            }
            if (projectId === null) {
                return res.status(422).json({ message: "Must be an integer" });
            }

            const customInstructions = await prisma.aI_Custom_Instructions.findFirst({
                where: {
                    projectId,
                    project: getProjectWhere(currentUser.id),
                },
                include: { attachments: true },
            });

            return res.status(200).json(customInstructions);
        } catch (error) {
            console.log(error);
            return res.status(500).json(error);
        }
    }

    if (req.method === "DELETE"){
        // delete an attachment
        const fileId = validateIntegerParam(req.query.fileIdToRemove, 'fileIdToRemove', res);
        const projectId = validateIntegerParam(req.query.projectId, 'projectId', res);
        // const fileId = validateIntegerParam(req.query.fileIdToRemove, 'fileIdToRemove', res);

        // Early return if validation failed
        if (fileId === null) {
            return res.status(422).json({message:"Must be an integer"});
        }        

        await prisma.attachment.delete({
            where:{
                id:fileId
            }
        })
        return res.status(200).json({message:"Successfully deleted!"})
    }

    else if (req.method === "POST"){

        // lets create a fuckin view shall we. and now lets lets lets add a view
        try {

            const { projectId, customInstruction, modelSelected, modelOptionId } = req.body
            const hasModelSelection =
                typeof modelOptionId === "string" || typeof modelSelected === "string";
            const selectedModelOption = hasModelSelection
                ? getAiModelOptionById(modelOptionId) ??
                  getAiModelOptionById(modelSelected) ??
                  defaultAiModelOption
                : undefined;
            if (!projectId) return res.status(101).json({ message: "Missing required information" })

            var customInstructions;
            // lets first find out if the customInstruction exists or not.
            customInstructions = await prisma.aI_Custom_Instructions.findFirst({
                where: {
                    projectId
                }
            })
            // ============ if doesn't exist, create it
            if (!customInstructions) {
                customInstructions = await prisma.aI_Custom_Instructions.create({
                    data: {
                        projectId,
                        customInstruction,
                        source_selected: selectedModelOption?.source,
                        model_selected: selectedModelOption?.id,
                    },
                    include:{attachments:true}
                })
            }

            // =========== if exists, then update it.
            else {
                const currentTime = new Date()
                customInstructions = await prisma.aI_Custom_Instructions.update({
                    where: {
                        id: customInstructions.id,
                    },
                    data: {
                        customInstruction,
                        ...(selectedModelOption
                            ? {
                                source_selected: selectedModelOption.source,
                                model_selected: selectedModelOption.id,
                            }
                            : {}),
                        lastUpdatedAt: currentTime,
                    },
                    include:{
                        attachments:true
                    }
                })
            }


            return res.status(200).json(customInstructions)
        } catch (error) {
            console.log(error)
            return res.status(500).json(error)
        }
    }
}
