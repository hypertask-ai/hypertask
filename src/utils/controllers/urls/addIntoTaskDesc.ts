// Import PrismaClient from the generated Prisma client
import { IUrl } from '@/models/model';

// Create an instance of PrismaClient
import prisma from "@/lib/prisma";
import { measuredSizeString } from "@/lib/attachments/measuredSize";
import { urlRowData } from '@/lib/attachments/urlRowData';


// Example usage
export const addIntoTaskDesc = async (urlsToAdd:IUrl[], taskId:number, method:string|undefined) => {
if (method==="POST"){

  // console.log(commentId)
  if (urlsToAdd.length==0 &&!taskId ) {
      return({
        status:400,
        json:{ message: "Missing Required Data" }
      })
      // return res.status(400).json({ message: "Missing Required Data" });
  }
  try {
    const urlRecords = await prisma.url.createMany({
        // Only Url columns: fileSize rides along on IUrl for the attachment
        // row and is not a column here, so spreading would fail the write.
        data: urlsToAdd.map(urlData => urlRowData(urlData, { taskId }))
        });
    return({
      status:200,
      json:urlRecords
    })        
    // return res.status(200).json(urlRecords)       
  } catch (error) {
    console.error('Error:', error);
    return({
      status:300,
      json:{message:"No response"}
    }) 
    // return res.status(300)
  }
}

else if (method==="PUT"){
  try {
    // const { urlsToAdd, taskId } = req.body;
    // console.log("🚀 ~ file: addIntoTask.ts:82 ~ consthandler:NextApiHandler= ~ urlsToAdd:", urlsToAdd)

    if (!taskId){
      return({
        status:200,
        json:{message:" NO TASKID"}
      }) 
      // return res.status(300).json({message:" NO TASKID"})
    }

    // Fetch existing URLs for the given commentId
    const existingUrls = await prisma.url.findMany({
      where: {
        TaskId: taskId,
        commentId:null
      },
    });
    // console.log(existingUrls)

    // // Iterate through existingUrls and update or delete as needed
    for (const existingUrl of existingUrls) {
      // console.log(existingUrl)

      const matchedUrlData = urlsToAdd.find(
        (urlData:IUrl) =>
          urlData.urlString === existingUrl.urlString &&
          urlData.TaskId === existingUrl.TaskId&&
          existingUrl.commentId===null
      );

      if (matchedUrlData) {
        // Update the existing URL
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
        // Delete the existing URL if not found in urlsToAdd
        await prisma.url.delete({
          where: { id: existingUrl.id },
        });
      }
    }
    
    // // Insert new URLs from urlsToAdd
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

    // console.log(newUrlsToAdd)
    // if (newUrlsToAdd.length > 0) {
    //   await prisma.url.createMany({
    //     data: newUrlsToAdd,
    //   });
    // }
    // find description of that task
    const description = await prisma.description.findFirst({
      where:{
        taskId:taskId
      }
    })

    // URL rows are the durable origin marker for editor-derived attachments.
    // Replace only attachment rows represented by an old editor URL; legacy and
    // deterministic MCP uploads have no such row and must survive text edits.
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
    // for every attachment in urlsToAdd, create an attachment since all previous were deleted 
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

    // return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return({
      status:200,
      json:{ success: false, error: 'An error occurred.' }
    }) 
    // return res.status(500).json({ success: false, error: 'An error occurred.' });
  }


}
else return ({status:300, json:{message:"Method not Allowed!"}})
}

// Run the main function
export default addIntoTaskDesc;

// should only be one try catch, that wraps all the if and else if and else return, fix when you get time for it
