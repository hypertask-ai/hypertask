import { IUrl } from '@/models/model';

import prisma from "@/lib/prisma";
import { measuredSizeString } from "@/lib/attachments/measuredSize";
import { urlRowData } from '@/lib/attachments/urlRowData';


export const addIntoTaskDesc = async (urlsToAdd:IUrl[], taskId:number, method:string|undefined) => {
if (method==="POST"){
  if (urlsToAdd.length==0 &&!taskId ) {
      return({
        status:400,
        json:{ message: "Missing Required Data" }
      })
  }
  try {
    const urlRecords = await prisma.url.createMany({
        data: urlsToAdd.map(urlData => urlRowData(urlData, { taskId }))
        });
    return({
      status:200,
      json:urlRecords
    })        
  } catch (error) {
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

    const existingUrls = await prisma.url.findMany({
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
        await prisma.url.update({
          where: { id: existingUrl.id },
          data: {
            TaskId: taskId,
            urlString: matchedUrlData.urlString,
            Attachment: matchedUrlData.Attachment,
            title:matchedUrlData.title,
            
          },
          
        });
      } else {
        await prisma.url.delete({
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

    const description = await prisma.description.findFirst({
      where:{
        taskId:taskId
      }
    })

    const existingAttachments = description
      ? await prisma.attachment.findMany({
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
      await prisma.attachment.deleteMany({
        where: { id: { in: replaceableAttachmentIds } },
      });
    }
    for (const url of urlsToAdd){

    if (url.Attachment&&description&&!preservedSources.has(url.urlString)){
      const attachment_ = await prisma.attachment.create({
        data: {
          fileType: url.attachmentType??"",
          fileSource: url.urlString,
          fileName: url.title ?? "",
          fileSize: measuredSizeString(url.fileSize),
          descriptionId: description.id,
          taskId:taskId,
        }

      });
      console.log("🚀 ~ file: addIntoTaskDesc.ts:134 ~ addIntoTaskDesc ~ attachment_:", attachment_)

    }
    }
    for (const newUrl of newUrlsToAdd){
      

      const urlRecords = await prisma.url.create({
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
