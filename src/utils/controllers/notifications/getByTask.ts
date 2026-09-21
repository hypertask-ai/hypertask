import prisma from "@/lib/prisma";

// HTPR-4465: callers must pass a userId derived from the session, never one read
// off the request body. This marks notifications seen, and `seen` also decides
// whether the notification email goes out, so a caller-supplied id let anyone
// silence another user's email.
const notificationGetByTask = async (userId:number|string|string[], taskId:string|string[]) => {
        try {
            const updatedNotifications = await prisma.notification.updateMany({
                data: {
                    seen: true
                },
                where: {
                    userId: Number(userId),
                    taskId:parseInt(taskId as string),
                    status:"Normal"
                }
            })
            return ({
                status:200,
                json:updatedNotifications
            })
            // res.status(200).json(comments);
        } catch (error) {
            console.log(error);
            return ({
                status:500,
                json:{ message: "Internal server error" }
            })
            // res.status(500).json({ message: "Internal server error" });
        }

};

export default notificationGetByTask;