import prisma from "@/lib/prisma";




const commentsGetCountByTask= async (taskId:string | string[] ) => {

        try {

            const commentCounts = await prisma.comment.count({
              where: {
                  taskId: parseInt(taskId as string),
              },
          });
      
              
            // console.log("🚀 ~ file: getByTask.ts:26 ~ commentsGetByTask ~ comments:", comments)
            return({
                    status:200,
                    json:{taskId:taskId, commentCount: commentCounts}
                })
            // res.status(200).json(comments);
            // console.log(comments);
        } catch (error) {
            console.log(error);
            return({
                    status:500,
                    json:{ message: "Internal server error" }
                })
            // res.status(500).json({ message: "Internal server error" });
        }

};

export default commentsGetCountByTask;