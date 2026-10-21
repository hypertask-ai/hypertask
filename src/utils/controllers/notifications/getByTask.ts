import prisma from "@/lib/prisma";

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
        } catch (error) {
            console.log(error);
            return ({
                status:500,
                json:{ message: "Internal server error" }
            })
        }

};

export default notificationGetByTask;