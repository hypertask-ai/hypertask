// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'

import { generateSummariesByTeamIdHandler } from './queues/AiSummary/generateSummaryAfterUpsertionQueue';



export default  async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
 
  try {
    
    const {teamId} = req.body;
    await generateSummariesByTeamIdHandler(teamId)
    return res.status(200)
    
  } catch (error) {
      console.log(error)
      return res.status(500).json(error)
  }
}
