// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { generateSummariesByTeamIdHandler } from '../../queues/AiSummary/generateSummaryAfterUpsertionQueue';



export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
    const {teamId, password} = req.body;
    if (password!==process.env.NEXTAUTH_SECRET) throw {message:"Unauthorized"} 
  try {
    if (await generateSummariesByTeamIdHandler(teamId) === "Success") return res.status(200)

  } catch (error) {
    console.log("🚀 ~ error:", error)
    return res.status(500).json(error)
  }
}