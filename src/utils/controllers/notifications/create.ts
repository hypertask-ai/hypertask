import prisma from "@/lib/prisma";


const notificationCreate = async(data:any)=>{
    await prisma.notification.create({
        data:data.data
    })
}

export default notificationCreate