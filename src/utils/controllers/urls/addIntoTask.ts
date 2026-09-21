// Import PrismaClient from the generated Prisma client
import { IUrl } from '@/models/model';

import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
// Create an instance of PrismaClient
import prisma from "@/lib/prisma";
import { measuredSizeString } from "@/lib/attachments/measuredSize";
import { urlRowData } from "@/lib/attachments/urlRowData";


// Example usage
const addIntoTask = async (urlsToAdd:IUrl[],commentId:number,method:string|undefined) => {
  console.log("🚀 ~ file: addIntoTask.ts:12 ~ constaddIntoTask:NextApiHandler= ~ commentId:", commentId)
  console.log("🚀 ~ file: addIntoTask.ts:12 ~ constaddIntoTask:NextApiHandler= ~ urlsToAdd:", urlsToAdd)

  if (method === "POST") {
    try {
      if (urlsToAdd.length > 0 && !commentId) {
        return({
          status:400,
          json:{ message: "Missing Required Data" }
        })
      }
      var response:any = []
      // forEach does not await its async callback, so the handler used to respond
      // 200 while these creates were still in flight (and swallowed their errors),
      // dropping comment attachments. Await sequentially like the PUT branch below.
      for (const url_ of urlsToAdd) {
        if (url_.Attachment){
          const attachment_ = await prisma.attachment.create({
            data: {
              fileType: url_.attachmentType??"",
              fileSource: url_.urlString,
              fileName: url_.title ?? "",
              // A hardcoded "1" used to be written here, which made every
              // editor-uploaded attachment claim it was one byte long and fail
              // the download integrity check. Unknown stays null, not a lie.
              fileSize: measuredSizeString(url_.fileSize),
              commentId: commentId,
              taskId: url_.TaskId,
            }
          });
          response.push(attachment_)
          console.log("attachment_", attachment_);
        
        }

          const urlRecords = await prisma.url.create({
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
      console.error('Error:', error);
      return({
        status:300,
        json:{message:"No Response"}
      })
    }
  } 
  
  // =========================== UPDATING A COMMENT
  else if (method === "PUT") {
    try {
      // Fetch existing URLs for the given commentId
      const existingUrls = await prisma.url.findMany({
        where: {
          commentId: commentId,
        },
      });

      // Iterate through existingUrls and update or delete as needed
      for (const existingUrl of existingUrls) {
        const matchedUrlData = urlsToAdd.find(
          (urlData: IUrl) =>
            urlData.urlString === existingUrl.urlString &&
            urlData.commentId === existingUrl.commentId
        );

        if (matchedUrlData) {
          // Update the existing URL
          await prisma.url.update({
            where: { id: existingUrl.id },
            data: urlRowData(matchedUrlData),
          });
        } else {
          // Delete the existing URL if not found in urlsToAdd
          await prisma.url.delete({
            where: { id: existingUrl.id },
          });
        }
      }

      // Insert new URLs from urlsToAdd
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
        await prisma.url.createMany({
          data: newUrlsToAdd,
        });
      }

      return({
        status:200,
        json:{success:true}
      })
    } catch (error) {
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

// Export the main function
export default addIntoTask;
