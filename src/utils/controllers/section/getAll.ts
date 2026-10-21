import { PrismaClient, Section, Prisma } from '@prisma/client';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

import prisma from "@/lib/prisma";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";


const sectionGetAll = async (userId:number) => {


  if (!userId ) {
      return({
        status:400,
        json:{ message: "Missing Required Credentials" }
      })
  }
  try {
    const sections = await prisma.section.findMany({
      where: { project: projectContentAccessWhere(userId) },
    });
    return({
      status:200,
      json:sections
    })
  } catch (error) {
    console.error('Error:', error);
    return({
      status:500,
      json:{ message: "Something Went Wrong" }
    })
  }

}

export default sectionGetAll;