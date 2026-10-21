import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";


const getUserById= async (userId:number):Promise<any> => {
   
        try {
            const user = await prisma.user.findUnique({
                relationLoadStrategy: "join",
                where: {
                    id:userId 
                },
                select:{
                    id:true,
                    uid:true,
                    displayName:true,
                    photoURL:true,
                    email:true,
                    joinedAt:true,
                    UserSettingId:true,
                    accountId:true,
                    stripe_customer_id:true,
                    UserSetting:true
                }
            })

            return ({
                status:200,
                res:user
            })
        } catch (error) {
            console.log(error);
            
            return ({
                status:500,
                res:[]
            })
        }

};

export default getUserById;