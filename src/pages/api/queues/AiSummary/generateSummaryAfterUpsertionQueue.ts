import type { NextApiRequest, NextApiResponse } from "next";
import { withQstashSignature } from "@/lib/qstash";
import prisma from "@/lib/prisma"
import {
  generateAndStoreTaskSummary,
  SummaryRetryableError,
} from "@/app/api/ai/_lib/taskSummaries";

interface ITaskLocal{
    id: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const job = req.body as { teamId: string };
    console.log("🚀 ~ executing job:", job)

    if (await generateSummariesByTeamIdHandler(job.teamId) === "Success") {
      return res.status(200).json({ ok: true });
    } else {
      throw "Error"
    }
  } catch (error) {
    console.log("🚀 ~ error:", error)
    if (error instanceof SummaryRetryableError) {
      return res.status(503).json({ ok: false, retry: true });
    }
    // Return 200 so QStash does not retry an error we have already handled/logged.
    return res.status(200).json({ ok: false });
  }
}

export default withQstashSignature(handler);

export const config = {
  api: {
    bodyParser: false,
  },
};

export const generateSummariesByTeamIdHandler = async(teamId:string)=>{

    try {

        const allTasks = await prisma.task.findMany({
            where:{
                project:{teamId},
                status:{not:"Deleted"},

            },
            select:{
                id:true,
            },
            orderBy:{updatedAt:"desc"}
        })
        console.log(allTasks.length)
        const batchSize = 40;

        for (let i = 0; i < allTasks.length; i += batchSize) {
            const tasksBatch = allTasks.slice(i, i + batchSize);
            await generateBatchSummaries(tasksBatch);
            if (i + batchSize < allTasks.length) {
                console.log(`Waiting for 100ms before processing the next batch...`);
                await new Promise(resolve => setTimeout(resolve, 100)); // 10 seconds interval
            }
            console.log("tasks completed: ", i)
        }
        return "Success"
    } catch (error) {
        console.log("🚀 ~ upsertTasksByTeamIdHandler ~ error:", error)
        if (error instanceof SummaryRetryableError) throw error;
        return "Error"
    }
}


async function generateBatchSummaries(tasksBatch:ITaskLocal[]) {
    console.log("🚀 ~ processBatch ~ tasksBatch:", tasksBatch)
    try {
        for (const x of tasksBatch){
            const result = await generateAndStoreTaskSummary(x.id);
            if (!result) {
                console.log("generateAndStoreTaskSummary returned empty");
                continue;
            }
        }

        console.log("Batch operation completed.");
    } catch (error) {
        console.error("Error processing batch:", error);
        if (error instanceof SummaryRetryableError) throw error;
    }
}
