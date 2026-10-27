

import { descriptionContainerId } from "@/lib/constants/TaskDetail";
import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { IUrl } from "@/models/model";
import { extractUrlsFromContent, mergeUrls } from "@/utils/controllers/urls/extractUrlsFromContent";


const fetchUrls = async (taskId:string | string[], commentId?:string, includeSavedSources = false) => {
  
        try {
            if (!taskId) {
                return ({
                    status:400,
                    json:{ message: "User id is required" }
                })
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
        } catch (error) {
            console.log(error);
            return ({
                status:500,
                json:{ message: "Internal server error", error:error }
            })
        }
   
}

export default fetchUrls;
export async function resolveTicketUrls(urls: IUrl[], userId: number): Promise<IUrl[]> {
    const links = urls.map(url => {
        try {
            const parsed = new URL(url.urlString, "https://app.hypertask.ai");
            if (parsed.origin !== "https://app.hypertask.ai") return null;
            const match = parsed.pathname.match(/^\/detail\/project-(\d+)\/(\d+)\/?$/);
            if (!match) return null;
            const projectId = Number(match[1]);
            const uniqueIndex = Number(match[2]);
            if (!Number.isSafeInteger(projectId) || !Number.isSafeInteger(uniqueIndex)) return null;
            return { projectId, uniqueIndex };
        } catch {
            return null;
        }
    });
    const references = [...new Map(links.filter(link => link !== null).map(link => [`${link.projectId}/${link.uniqueIndex}`, link])).values()];
    if (!references.length) return urls;
    const tasks = await prisma.task.findMany({
        where: { OR: references, project: projectContentAccessWhere(userId), status: { not: "Deleted" } },
        select: { projectId: true, uniqueIndex: true, ticketNumber: true, title: true },
    }).catch(() => {
        console.error("[urls] Ticket titles unavailable");
        return [];
    });
    const byReference = new Map(tasks.map(task => [`${task.projectId}/${task.uniqueIndex}`, task]));
    return urls.map((url, index) => {
        const reference = links[index];
        if (!reference) return url;
        const task = byReference.get(`${reference.projectId}/${reference.uniqueIndex}`);
        if (!task) return { ...url, ticketNumber: undefined, title: `PROJECT-${reference.projectId}-${reference.uniqueIndex}` };
        return { ...url, ticketNumber: task.ticketNumber ?? undefined, title: task.title };
    });
}
