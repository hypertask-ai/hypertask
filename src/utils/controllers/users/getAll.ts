import { NextApiHandler, NextApiRequest, NextApiResponse } from "next";


import prisma from "@/lib/prisma";


const getAllUsers= async () => {
   
        try {
            const users = await prisma.user.findMany({
                where: {
                }
            })
            return ({
                status:200,
                res:users
            })
        } catch (error) {
            console.log(error);
            
            return ({
                status:200,
                res:[]
            })
        }

};

export default getAllUsers;