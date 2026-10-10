// Import PrismaClient from the generated Prisma client


import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import prisma from "@/lib/prisma";
import { IUrl } from "@/models/model";
import { extractUrlsFromContent, mergeUrls } from "@/utils/controllers/urls/extractUrlsFromContent";


// Example usage
const fetchUrls = async (taskId:string | string[], commentId?:string, includeSavedSources = false) => {
  
        try {
            if (!taskId) {
                return ({
                    status:400,
                    json:{ message: "User id is required" }
                })
                // return res.status(400).json({ message: "User id is required" });
            }
            if (includeSavedSources) {
                const id = parseInt(taskId as string);
                const [storedUrls, task] = await Promise.all([
                    prisma.url.findMany({ where: { TaskId: id }, orderBy: { id: "desc" } }),
                    prisma.task.findUnique({
                        where: { id },
                        select: {
                            description_: { select: { content: true, attachments: true } },
                            attachments: true,
                            comments: { select: { id: true, text: true, attachments: true }, orderBy: { id: "desc" } },
                        },
                    }),
                ]);
                const contentUrls: IUrl[] = [
                    ...extractUrlsFromContent(task?.description_?.content ?? "", id),
                    ...(task?.comments.flatMap(comment =>
                        extractUrlsFromContent(comment.text, id).map(url => ({ ...url, commentId: comment.id }))
                    ) ?? []),
                ];
                // Attachments can exist without a legacy Url row, including uploads from MCP.
                const attachments = [
                    ...(task?.attachments ?? []),
                    ...(task?.description_?.attachments ?? []),
                    ...(task?.comments.flatMap(comment => comment.attachments) ?? []),
                ].map(attachment => ({
                    TaskId: id,
                    urlString: attachment.fileSource,
                    title: attachment.fileName,
                    commentId: attachment.commentId ?? undefined,
                    Attachment: true,
                    attachmentType: attachment.fileType,
                }));
                const focusedComment = commentId && /^\d+$/.test(commentId) ? Number(commentId) : null;
                const urls = mergeUrls(attachments, contentUrls, storedUrls.map(url => ({ ...url, commentId: url.commentId ?? undefined })) as IUrl[]);
                urls.sort((a, b) => {
                    const rank = (url: IUrl) => (url.commentId ?? null) === focusedComment ? 0 : 1;
                    return rank(a) - rank(b);
                });
                return { status: 200, json: urls };
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