
import { uploadAttachmentToAICustomInstruction } from '@/lib/serverActions';
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
    ContentType: `image/${type}`, // required. Notice the back ticks
    // ContentEncoding: 'base64', // required

    Key: `tasks/${fileName}.png`, // Specify the desired path and filename    const result = await s3.upload(params).promise();
    Body: base64Data, // The file content (e.g., obtained from an HTML input element)
    
  };
  // console.log("params ==>",params)

  try {
    const result = await s3.upload(params).promise();
    console.log('File uploaded successfully:', result.Location);
    return getHypertasksStoragePublicUrl(params.Key); // Returns the URL of the uploaded file
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
    return uploadResults.map(x=>x.source); // Returns an array of URLs of the uploaded files
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
    ContentType: file.type, // Use the correct content type based on the file type
    Key: `tasks/task-${taskId}/attachments/${timenow+fileName}`,
    Body: Body,
  };

  await s3.upload(params).promise();
  return getHypertasksStoragePublicUrl(params.Key);
}

// AI_Custom_Instructions_id is there just to accommodate the RAG custom instruction uploads
export const uploadSingleAttachmentTrackProgress = async(file:File, callback?:any, AI_Custom_Instructions_id?:number)=>{

  const s3 = getHypertasksS3Client();
  const Body = (await file.arrayBuffer()) as unknown as Buffer;
  var uploadedFileFromRAG;
  const fileName = file.name;
  const fileSize = file.size
  const timenow = Date.now();

  const params = {
    Bucket: HYPERTASKS_S3_BUCKET,
    ContentType: file.type, // Use the correct content type based on the file type
    Key: `tasks/attachments/${timenow+fileName}`,
    Body: Body,
  };
  console.log("🚀 ~ uploadSingleAttachmentTrackProgress ~ params:", params)
 // Wrap the AWS SDK's upload method in a Promise
 const uploadPromise = new Promise((resolve, reject) => {
  s3.upload(params, function(err: any, data: any) {
    if (err) {
      console.log('There was an error uploading your file: ', err);
      reject(err); // Reject the promise if there's an error
    } else {
      console.log('Successfully uploaded file.', data);
      resolve(data); // Resolve the promise with the data
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
    
  // Wait for the upload to complete, why isnt it called like uploadPromise()
  await uploadPromise;
  const publicUrl = getHypertasksStoragePublicUrl(params.Key);
  console.log("🚀 ~ uploadSingleAttachmentTrackProgress ~ result:", publicUrl)
  // if the AI_Custom_Instructions_id is present that means it needs to be uploaded to the AI_CUSTON_INSTRUCTION
  // so lets call a server action here.
  if (AI_Custom_Instructions_id) {
    uploadedFileFromRAG = await uploadAttachmentToAICustomInstruction({
      fileSize,
      name:fileName,
      S3URL:publicUrl,
      type:file.type,
      AI_Custom_Instructions_id
    })
    
    // console.log("🚀 ~ result ~ result:", result)
  }
  return {
    source:publicUrl,
    uploadedFileFromRAG
  };
}
