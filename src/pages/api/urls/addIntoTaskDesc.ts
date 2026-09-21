// Import PrismaClient from the generated Prisma client
import addIntoTaskDesc from '@/utils/controllers/urls/addIntoTaskDesc';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
// Create an instance of PrismaClient


// Example usage
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  try {
    const {urlsToAdd, taskId}=req.body
    if (!urlsToAdd || !taskId) return res.status(300).json({message:"Missing Required Data"})
    
    const response = await addIntoTaskDesc(urlsToAdd, taskId, req.method)
    return res.status(response.status).json(response.json)
  } 
  catch (error) {
    return res.status(500).json({message:"Something went wrong!", error:error})
  }
// if (req.method==="POST"){

//   const { urlsToAdd, taskId}:{urlsToAdd:IUrl[], commentId:number, taskId:number} = req.body;
//   // console.log(commentId)
//   if (urlsToAdd.length==0 &&!taskId ) {
//       return res.status(400).json({ message: "Missing Required Data" });
//   }
//   try {
//     const urlRecords = await prisma.url.createMany({
//         data: urlsToAdd.map(urlData => ({
//             ...urlData,
//             TaskId:taskId
//         }))
//         });
//     return res.status(200).json(urlRecords)       
//   } catch (error) {
//     console.error('Error:', error);
//     return res.status(300)
//   } finally {
//     // Disconnect the PrismaClient to release the database connection
//     await prisma.$disconnect();
//   }
// }

// else if (req.method==="PUT"){
//   try {
//     const { urlsToAdd, taskId } = req.body;
//     // console.log("🚀 ~ file: addIntoTask.ts:82 ~ consthandler:NextApiHandler= ~ urlsToAdd:", urlsToAdd)

//     if (!taskId){
//       return res.status(300).json({message:" NO TASKID"})
//     }

//     // Fetch existing URLs for the given commentId
//     const existingUrls = await prisma.url.findMany({
//       where: {
//         TaskId: taskId,
//         commentId:null
//       },
//     });
//     // console.log(existingUrls)

//     // // Iterate through existingUrls and update or delete as needed
//     for (const existingUrl of existingUrls) {
//       // console.log(existingUrl)

//       const matchedUrlData = urlsToAdd.find(
//         (urlData:IUrl) =>
//           urlData.urlString === existingUrl.urlString &&
//           urlData.TaskId === existingUrl.TaskId&&
//           existingUrl.commentId===null
//       );

//       if (matchedUrlData) {
//         // Update the existing URL
//         await prisma.url.update({
//           where: { id: existingUrl.id },
//           data: matchedUrlData,
//         });
//       } else {
//         // Delete the existing URL if not found in urlsToAdd
//         await prisma.url.delete({
//           where: { id: existingUrl.id },
//         });
//       }
//     }
    
//     // // Insert new URLs from urlsToAdd
//     const newUrlsToAdd = urlsToAdd
//     .filter(
//       (urlData:IUrl) =>
//         !existingUrls.some(
//           (existingUrl) =>
//             urlData.urlString === existingUrl.urlString &&
//             urlData.TaskId === existingUrl.TaskId
//           )
//       )
//       .map((urlData:IUrl) => ({
//         ...urlData,
//         urlString:urlData.urlString,
//         TaskId: taskId,
//       }));

//     // console.log(newUrlsToAdd)
//     if (newUrlsToAdd.length > 0) {
//       await prisma.url.createMany({
//         data: newUrlsToAdd,
//       });
//     }

//     return res.status(200).json({ success: true });
//   } catch (error) {
//     console.error('Error:', error);
//     return res.status(500).json({ success: false, error: 'An error occurred.' });
//   }


// }
}

// Run the main function
export default handler;