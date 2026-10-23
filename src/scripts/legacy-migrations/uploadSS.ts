
import { uploadAttachmentToAICustomInstruction } from '@/lib/serverActions/uploadAttachmentToAICustomInstruction';
import {
  getHypertasksS3Client,
  getHypertasksStoragePublicUrl,
  HYPERTASKS_S3_BUCKET,
} from "@/lib/storage/hypertasksS3";
import { NextApiRequest } from 'next';

export const uploadImageToS3= async(base64:any,fileName:any)=> {

  const s3 = getHypertasksS3Client();
  const base64Data = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), 'base64');

  const type = base64.split(';')[0].split('/')[1];
  const params = {
    Bucket: HYPERTASKS_S3_BUCKET,
    ContentType: `image/${type}`,

    Key: `tasks/${fileName}.png`,
    Body: base64Data,
  };

  try {
    const result = await s3.upload(params).promise();
    console.log('File uploaded successfully:', result.Location);
    return getHypertasksStoragePublicUrl(params.Key);
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

export const uploadAttachmentsToS3= async(files:File[], taskId:number):Promise<any>=> {

 
  try {
    const uploadPromises = Array.from(files).map(async (file, index) => {
     return await uploadSingleAttachmentTrackProgress(file, taskId)
    });

    const uploadResults = await Promise.all(uploadPromises);
    return uploadResults.map(x=>x.source);
  } catch (error) {
    console.error('Error uploading files:', error);
    throw error;
    return []
  }
}

export const uploadSingleAttachment = async(file:File,taskId:number,)=>{
  const s3 = getHypertasksS3Client();
  const Body = (await file.arrayBuffer()) as unknown as Buffer;

  const fileName = file.name;
  const timenow = Date.now();

  const params = {
    Bucket: HYPERTASKS_S3_BUCKET,
    ContentType: file.type,
    Key: `tasks/task-${taskId}/attachments/${timenow+fileName}`,
    Body: Body,
  };

  await s3.upload(params).promise();
  return getHypertasksStoragePublicUrl(params.Key);
}

export const uploadSingleAttachmentTrackProgress = async(file:File, callback?:any, AI_Custom_Instructions_id?:number)=>{

  const s3 = getHypertasksS3Client();
  const Body = (await file.arrayBuffer()) as unknown as Buffer;
  var uploadedFileFromRAG;
  const fileName = file.name;
  const fileSize = file.size
  const timenow = Date.now();

  const params = {
    Bucket: HYPERTASKS_S3_BUCKET,
    ContentType: file.type,
    Key: `tasks/attachments/${timenow+fileName}`,
    Body: Body,
  };
  console.log("🚀 ~ uploadSingleAttachmentTrackProgress ~ params:", params)
 const uploadPromise = new Promise((resolve, reject) => {
  s3.upload(params, function(err: any, data: any) {
    if (err) {
      console.log('There was an error uploading your file: ', err);
      reject(err);
    } else {
      console.log('Successfully uploaded file.', data);
      resolve(data);
    }
  }).on('httpUploadProgress', async function(progress) {
    let progressPercentage = Math.round(progress.loaded / progress.total * 100);
    
    callback(progressPercentage)
    if (progressPercentage < 100) {
      console.log("🚀 ~ result ~ during:", progressPercentage)
    } else if (progressPercentage == 100) {
      console.log("🚀 ~ result ~ final progressPercentage:", progressPercentage)
      console.log("FILE UPLOADED")

      
    }
  });
  });
    
  await uploadPromise;
  const publicUrl = getHypertasksStoragePublicUrl(params.Key);
  console.log("🚀 ~ uploadSingleAttachmentTrackProgress ~ result:", publicUrl)
  if (AI_Custom_Instructions_id) {
    uploadedFileFromRAG = await uploadAttachmentToAICustomInstruction({
      fileSize,
      name:fileName,
      S3URL:publicUrl,
      type:file.type,
      AI_Custom_Instructions_id
    })
  }
  return {
    source:publicUrl,
    uploadedFileFromRAG
  };
}
