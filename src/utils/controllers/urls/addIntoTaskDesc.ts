import { verifyTaskAttachmentLinks } from "@/lib/storage/verifyTaskAttachmentLinks";
import { isPlanLimitReachedError, isPlanLimitsEnabled, type PlanLimitContext } from "@/lib/planLimits";
import type { Prisma } from "@prisma/client";
import { IUrl } from '@/models/model';

import prisma from "@/lib/prisma";
import { measuredSizeString } from "@/lib/attachments/measuredSize";
import { urlRowData } from '@/lib/attachments/urlRowData';


export const addIntoTaskDesc = async (urlsToAdd:IUrl[], taskId:number, method:string|undefined, db: Prisma.TransactionClient = prisma, planLimitContext?: PlanLimitContext): Promise<{ status: number; json: any }> => {
if (db === prisma && planLimitContext && method === "PUT" && urlsToAdd.some((url) => url.Attachment) && await isPlanLimitsEnabled(planLimitContext.actorUserId)) {
  return prisma.$transaction((tx) => addIntoTaskDesc(urlsToAdd, taskId, method, tx, planLimitContext), { timeout: 10_000 });
}
const measuredSizes = planLimitContext && method === "PUT"
  ? await verifyTaskAttachmentLinks(db, urlsToAdd.filter((url) => url.Attachment).map((url) => url.urlString), { taskId }, planLimitContext)
  : new Map<string, number>();
if (method==="POST"){
  if (urlsToAdd.length==0 &&!taskId ) {
      return({
        status:400,
        json:{ message: "Missing Required Data" }
      })
  }
  try {
    const urlRecords = await db.url.createMany({
        data: urlsToAdd.map(urlData => urlRowData(urlData, { taskId }))
        });
    return({
      status:200,
      json:urlRecords
    })        
  } catch (error) {
    if (isPlanLimitReachedError(error)) throw error;
    console.error('Error:', error);
    return({
      status:300,
      json:{message:"No response"}
    }) 
  }
}

else if (method==="PUT"){
  try {
    if (!taskId){
      return({
        status:200,
        json:{message:" NO TASKID"}
      }) 
    }

    const existingUrls = await db.url.findMany({
      where: {
        TaskId: taskId,
        commentId:null
      },
    });

    for (const existingUrl of existingUrls) {
      const matchedUrlData = urlsToAdd.find(
        (urlData:IUrl) =>
          urlData.urlString === existingUrl.urlString &&
          urlData.TaskId === existingUrl.TaskId&&
          existingUrl.commentId===null
      );

      if (matchedUrlData) {
        await db.url.update({
          where: { id: existingUrl.id },
          data: {
            TaskId: taskId,
            urlString: matchedUrlData.urlString,
            Attachment: matchedUrlData.Attachment,
            title:matchedUrlData.title,
            
          },
          
        });
      } else {
        await db.url.delete({
          where: { id: existingUrl.id },
        });
      }
    }
    
    const newUrlsToAdd = urlsToAdd
    .filter(
      (urlData:IUrl) =>
        !existingUrls.some(
          (existingUrl) =>
            urlData.urlString === existingUrl.urlString &&
            urlData.TaskId === existingUrl.TaskId
          )
      )
      .map((urlData:IUrl) => ({
        ...urlData,
        urlString:urlData.urlString,
        TaskId: taskId,
      }));

    const description = await db.description.findFirst({
      where:{
        taskId:taskId
      }
    })

    const existingAttachments = description
      ? await db.attachment.findMany({
          where: { descriptionId: description.id },
          select: { id: true, fileSource: true },
        })
      : [];
    const editorDerivedSources = new Set(
      existingUrls
        .filter(({ Attachment }) => Attachment)
        .map(({ urlString }) => urlString)
    );
    const preservedSources = new Set(
      existingAttachments
        .filter(({ fileSource }) => !editorDerivedSources.has(fileSource))
        .map(({ fileSource }) => fileSource)
    );
    const replaceableAttachmentIds = existingAttachments
      .filter(({ fileSource }) => !preservedSources.has(fileSource))
      .map(({ id }) => id);
    if (replaceableAttachmentIds.length > 0) {
      await db.attachment.deleteMany({
        where: { id: { in: replaceableAttachmentIds } },
      });
    }
    for (const url of urlsToAdd){

    if (url.Attachment&&description&&!preservedSources.has(url.urlString)){
      const attachment_ = await db.attachment.create({
        data: {
          fileType: url.attachmentType??"",
          fileSource: url.urlString,
          fileName: url.title ?? "",
          fileSize: measuredSizeString(measuredSizes.get(url.urlString) ?? url.fileSize),
          descriptionId: description.id,
          taskId:taskId,
        }

      });
      console.log("🚀 ~ file: addIntoTaskDesc.ts:134 ~ addIntoTaskDesc ~ attachment_:", attachment_)

    }
    }
    for (const newUrl of newUrlsToAdd){
      

      const urlRecords = await db.url.create({
        data: {
          urlString:newUrl.urlString??"",
          TaskId: taskId,
          title:newUrl.title,
          Attachment:newUrl.Attachment?true:false
        }
      });
      console.log("🚀 ~ file: addIntoTaskDesc.ts:145 ~ addIntoTaskDesc ~ urlRecords:", urlRecords)
    }

    return({
      status:200,
      json:{ success: true }
    }) 
  } catch (error) {
    if (isPlanLimitReachedError(error)) throw error;
    console.error('Error:', error);
    return({
      status:200,
      json:{ success: false, error: 'An error occurred.' }
    }) 
  }


}
else return ({status:300, json:{message:"Method not Allowed!"}})
}

export default addIntoTaskDesc;
