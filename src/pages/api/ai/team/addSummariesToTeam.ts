import { env as appEnv } from "#env";
import { logger as htLogger } from "#logger";
import { withAuth } from "#with-auth";
// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiRequest, NextApiResponse } from 'next'
import prisma from "@/lib/prisma";
import { generateSummariesByTeamIdHandler } from '../../queues/AiSummary/generateSummaryAfterUpsertionQueue';



async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
    const {teamId, password} = req.body;
    if (password!==appEnv.NEXTAUTH_SECRET) throw {message:"Unauthorized"}
  try {
    if (await generateSummariesByTeamIdHandler(teamId) === "Success") return res.status(200)

  } catch (error) {
    htLogger.info("🚀 ~ error:", error)
    return res.status(500).json(error)
  }
}

export default withAuth(handler, { authenticateInHandler: true });
