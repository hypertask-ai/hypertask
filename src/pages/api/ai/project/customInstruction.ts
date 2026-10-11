import { getAiDefaultModelContext } from "@/app/api/ai/_lib/byokKeys";
import { getDefaultAiModelOptionForPlan } from "@/lib/aiModelOptions";
import { haiku55ModelEnabled, lunaFreePlanEnabled } from "@/app/api/ai/_lib/planGate";
import { reportError } from "@/lib/errors/reportError";
import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { validateIntegerParam } from '@/utils/helperFunctions/multiPages';
import {
    defaultAiModelOption,
    getAiModelOptionById,
} from '@/lib/aiModelOptions';
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes';
import { getSessionUser } from "@/lib/auth/getSessionUser";

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    if (req.method === "GET") {
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        const userId = session.userId;
        try {
            const projectId = validateIntegerParam(req.query.projectId, 'projectId', res);

            if (projectId === null) {
                return res.status(422).json({ message: "Must be an integer" });
            }

            const customInstructions = await prisma.aI_Custom_Instructions.findFirst({
                where: {
                    projectId,
                    project: getProjectWhere(userId),
                },
                include: { attachments: true },
            });

            const haiku55Enabled = await haiku55ModelEnabled(userId);
            const selected = haiku55Enabled ? getAiModelOptionById(customInstructions?.model_selected, true) : undefined;
            return res.status(200).json(customInstructions && selected ? {
                ...customInstructions, model_selected: selected.id, source_selected: selected.source,
            } : customInstructions);
        } catch (error) {
            await reportError({
              message: error instanceof Error ? error.message : "AI request failed",
              stack: error instanceof Error ? error.stack : undefined,
              url: "/api/ai/project/customInstruction",
              source: "handled",
              extra: { stage: "load" },
            });
            console.log(error);
            return res.status(500).json(error);
        }
    }

    if (req.method === "DELETE"){
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }
        // delete an attachment
        const fileId = validateIntegerParam(req.query.fileIdToRemove, 'fileIdToRemove', res);
        const projectId = validateIntegerParam(req.query.projectId, 'projectId', res);
        // const fileId = validateIntegerParam(req.query.fileIdToRemove, 'fileIdToRemove', res);

        // Early return if validation failed
        if (fileId === null || projectId === null) {
            return res.status(422).json({message:"Must be an integer"});
        }

        const attachment = await prisma.attachment.findFirst({
            where: {
                id: fileId,
                AI_Custom_Instructions: {
                    projectId,
                    project: getProjectWhere(session.userId),
                },
            },
            select: { id: true },
        })
        if (!attachment) {
            return res.status(404).json({ message: "Not found" });
        }

        await prisma.attachment.delete({
            where:{
                id:fileId
            }
        })
        return res.status(200).json({message:"Successfully deleted!"})
    }

    else if (req.method === "POST"){
        const session = await getSessionUser(
          new Headers(req.headers as Record<string, string>)
        );
        if (!session) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        // lets create a fuckin view shall we. and now lets lets lets add a view
        try {

            const { projectId, customInstruction, modelSelected, modelOptionId } = req.body
            const haiku55Enabled = await haiku55ModelEnabled(session.userId);
            if (!projectId) return res.status(101).json({ message: "Missing required information" })

            const project = await prisma.project.findFirst({
                where: {
                    id: Number(projectId),
                    ...getProjectWhere(session.userId),
                },
                select: { id: true },
            })
            if (!project) return res.status(404).json({ message: "Project not found" })

            const defaultContext = haiku55Enabled ? await getAiDefaultModelContext({ projectId: Number(projectId), userId: session.userId }, true) : undefined;
            const hasModelSelection =
                typeof modelOptionId === "string" || typeof modelSelected === "string";
            const selectedModelOption = hasModelSelection
                ? getAiModelOptionById(modelOptionId, haiku55Enabled) ??
                  getAiModelOptionById(modelSelected, haiku55Enabled) ??
                  (haiku55Enabled ? getDefaultAiModelOptionForPlan(defaultContext?.plan, defaultContext?.hasByok, await lunaFreePlanEnabled(session.userId), true, defaultContext?.haikuDefaultEnabled) : defaultAiModelOption)
                : undefined;

            var customInstructions;
            // lets first find out if the customInstruction exists or not.
            customInstructions = await prisma.aI_Custom_Instructions.findFirst({
                where: {
                    projectId,
                    project: getProjectWhere(session.userId),
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
            await reportError({
              message: error instanceof Error ? error.message : "AI request failed",
              stack: error instanceof Error ? error.stack : undefined,
              url: "/api/ai/project/customInstruction",
              source: "handled",
              extra: { stage: "update" },
            });
            console.log(error)
            return res.status(500).json(error)
        }
    }
}
