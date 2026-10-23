import prisma from "../prisma"
import { IAttachment } from "@/models/model"

export type TUploadToAICustomInstruction = {
  AI_Custom_Instructions_id: number;
  S3URL: string;
  type: string;
  name: string;
  fileSize:number

}
export type TReturnAIRAGUpload = {
  status:number;
  text:string;
  data:IAttachment | unknown
}
export const uploadAttachmentToAICustomInstruction = async (props: TUploadToAICustomInstruction): Promise<TReturnAIRAGUpload> => {
  const { AI_Custom_Instructions_id, S3URL, type, name, fileSize } = props
  try {
    const attachment_ = await prisma.attachment.create({
      data: {
        fileType: type ?? "",
        fileSource: S3URL,
        fileName: name ?? "",
        fileSize: String(fileSize),
        AI_Custom_Instructions_id,
      }
    });
    return {
      status:200,
      data:attachment_,
      text:'success',
    }
  } catch (error) {
    console.log("🚀 ~ uploadAttachmentToAICustomInstruction ~ error:", error)
    return {
      status:500,
      data:error,
      text:'error'
    }
  }
}
