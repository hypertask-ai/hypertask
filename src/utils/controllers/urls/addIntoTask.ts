import { verifyTaskAttachmentLinks } from "@/lib/storage/verifyTaskAttachmentLinks";
import { isPlanLimitReachedError, isPlanLimitsEnabled, type PlanLimitContext } from "@/lib/planLimits";
import type { Prisma } from "@prisma/client";
import { IUrl } from '@/models/model';

import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import prisma from "@/lib/prisma";
import { measuredSizeString } from "@/lib/attachments/measuredSize";
import { urlRowData } from "@/lib/attachments/urlRowData";


const addIntoTask = async (urlsToAdd:IUrl[],commentId:number,method:string|undefined, db: Prisma.TransactionClient = prisma, planLimitContext?: PlanLimitContext): Promise<{ status: number; json: any }> => {
  console.log("🚀 ~ file: addIntoTask.ts:12 ~ constaddIntoTask:NextApiHandler= ~ commentId:", commentId)
  console.log("🚀 ~ file: addIntoTask.ts:12 ~ constaddIntoTask:NextApiHandler= ~ urlsToAdd:", urlsToAdd)

  if (db === prisma && planLimitContext && method === "POST" && urlsToAdd.some((url) => url.Attachment) && await isPlanLimitsEnabled(planLimitContext.actorUserId)) {
  return prisma.$transaction((tx) => addIntoTask(urlsToAdd, commentId, method, tx, planLimitContext), { timeout: 10_000 });
}
const measuredSizes = planLimitContext && method === "POST"
    ? await verifyTaskAttachmentLinks(db, urlsToAdd.filter((url) => url.Attachment).map((url) => url.urlString), { commentId }, planLimitContext)
    : new Map<string, number>();

  if (method === "POST") {
    try {
      if (urlsToAdd.length > 0 && !commentId) {
        return({
          status:400,
          json:{ message: "Missing Required Data" }
        })
      }
      var response:any = []
      for (const url_ of urlsToAdd) {
        if (url_.Attachment){
          const attachment_ = await db.attachment.create({
            data: {
              fileType: url_.attachmentType??"",
              fileSource: url_.urlString,
              fileName: url_.title ?? "",
              fileSize: measuredSizeString(measuredSizes.get(url_.urlString) ?? url_.fileSize),
              commentId: commentId,
              taskId: url_.TaskId,
            }
          });
          response.push(attachment_)
          console.log("attachment_", attachment_);
        
        }

          const urlRecords = await db.url.create({
            data: {
              urlString:url_.urlString??"",
              commentId: commentId,
              title:url_.title,
              TaskId:url_.TaskId

            }
          });
          response.push(urlRecords)

          console.log("🚀 ~ file: addIntoTask.ts:47 ~ urlsToAdd ~ urlRecords:", urlRecords)
      }
      return({
        status:200,
        json:response
      })
    } catch (error) {
    if (isPlanLimitReachedError(error)) throw error;
      console.error('Error:', error);
      return({
        status:300,
        json:{message:"No Response"}
      })
    }
  } 
  
  else if (method === "PUT") {
    try {
      const existingUrls = await db.url.findMany({
        where: {
          commentId: commentId,
        },
      });

      for (const existingUrl of existingUrls) {
        const matchedUrlData = urlsToAdd.find(
          (urlData: IUrl) =>
            urlData.urlString === existingUrl.urlString &&
            urlData.commentId === existingUrl.commentId
        );

        if (matchedUrlData) {
          await db.url.update({
            where: { id: existingUrl.id },
            data: urlRowData(matchedUrlData),
          });
        } else {
          await db.url.delete({
            where: { id: existingUrl.id },
          });
        }
      }

      const newUrlsToAdd = urlsToAdd
        .filter(
          (urlData: IUrl) =>
            !existingUrls.some(
              (existingUrl) =>
                urlData.urlString === existingUrl.urlString &&
                urlData.commentId === existingUrl.commentId &&
                urlData.TaskId === existingUrl.TaskId
            )
        )
        .map((urlData: IUrl) => urlRowData(urlData, { commentId }));

      if (newUrlsToAdd.length > 0) {
        await db.url.createMany({
          data: newUrlsToAdd,
        });
      }

      return({
        status:200,
        json:{success:true}
      })
    } catch (error) {
    if (isPlanLimitReachedError(error)) throw error;
      console.error('Error:', error);
      return({
        status:500,
        json:{ success: false, error: 'An error occurred.' }
      })
    }
  } else {
    return({
      status:500,
      json:{ success: false, error: 'Method Not Allowed' }
    })
  }
}

export default addIntoTask;
