import prisma from "@/lib/prisma";
const json = (param: any): any => {
    return JSON.stringify(
      param,
      (key, value) => (typeof value === "bigint" ? parseInt(value.toString()) : value) // return everything else unchanged
    );
  };
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
    try {
        const {emails} = req.body

        const moreAnswers = await prisma.user.findMany({
            where:{
                email:{in:emails}
            },
            select:{
                displayName:true,
                email:true,
                id:true,
                tasks:true
        }})
        console.log("🚀 ~ consthandler:NextApiHandler= ~ moreAnswers:", moreAnswers)

      return res.status(200).send(json(moreAnswers))
    } catch (error) {
      console.log("🚀 ~ consthandler:NextApiHandler= ~ error:", error)
      return res.status(500)
    }

  
}
export default handler