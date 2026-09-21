import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";

import { IUser } from "@/models/model";



const commentsGetByTask= async (user:IUser,commentIds:string[] ) => {

        // try {
        //     const comments = await prisma.comment.findMany({
        //         where: {
        //             taskId: parseInt(taskId as string)
        //         },
        //         orderBy: {
        //             createdAt: 'asc'
        //         }
        //     })
            
        //     // debug.log("🚀 ~ file: getByTask.ts:26 ~ commentsGetByTask ~ comments:", comments)
        //     return({
        //             status:200,
        //             json:comments
        //         })
        //     // res.status(200).json(comments);
        //     // debug.log(comments);
        // } catch (error) {
        //     debug.log(error);
        //     return({
        //             status:500,
        //             json:{ message: "Internal server error" }
        //         })
        //     // res.status(500).json({ message: "Internal server error" });
        // }

};

export default commentsGetByTask;