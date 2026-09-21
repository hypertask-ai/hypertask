// Import PrismaClient from the generated Prisma client
import { PrismaClient, Section, Prisma } from '@prisma/client';
import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

// Create an instance of PrismaClient
import prisma from "@/lib/prisma";


// Example usage
const sectionGetAll = async (userId:number) => {


  if (!userId ) {
      return({
        status:400,
        json:{ message: "Missing Required Credentials" }
      })
      // return res.status(400).json({ message: "Missing Required Credentials" });
  }
  try {
    // Get all sections
    const sections = await prisma.section.findMany();
    // console.log('Field Names:', Prisma.SectionScalarFieldEnum);
    return({
      status:200,
      json:sections
    })
    // return res.status(200).json(sections);
    // Get field names of the "Section" model
    
  } catch (error) {
    console.error('Error:', error);
    return({
      status:500,
      json:{ message: "Something Went Wrong" }
    })
  }

}

// Run the main function
export default sectionGetAll;