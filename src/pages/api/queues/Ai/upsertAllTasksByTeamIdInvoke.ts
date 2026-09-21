// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import type { NextApiRequest, NextApiResponse } from 'next'


export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {

    try {

        const { teamId } = req.body;
        await upsertTasksByTeamIdHandler(teamId)

        return res.status(200).json({ message: "Successfully upserted all tasks." })
    } catch (error) {
        console.log(error)
        return res.status(500).json(error)
    }
}

export const upsertTasksByTeamIdHandler = async (teamId: string) => {
    console.log("Pinecone team task/comment indexing is retired; skipping.", teamId)
    return "Success"
}
