import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import prisma from "@/lib/prisma";


const getUserById= async (userId:number):Promise<any> => {
   
        try {
            const user = await prisma.user.findUnique({
                where: {
                    id:userId 
                },
                // HTPR-6509: the fields the client reads from the current
                // user. Billing and token-revocation columns stay server-side.
                select:{
                    id:true,
                    uid:true,
                    displayName:true,
                    photoURL:true,
                    email:true,
                    joinedAt:true,
                    UserSettingId:true,
                    accountId:true,
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