import { waitUntil } from "@vercel/functions";
import {  CreateLogInput } from "@/models/model";
import { LogType, PrismaClient, Status } from "@prisma/client";

import prisma from "@/lib/prisma";


const createLog = async (data: CreateLogInput): Promise<any> => {
    try {

        console.log("🚀 ~ file: createLog.ts:12 ~ createLog ~ data.log:", data.log)
            const allLogs =await prisma.logs.create({
                data:{
                    log:data.log,
                    type:data.type as unknown as LogType,
                    status:data.status as unknown as Status,
                    LoggedById:data.LoggedById

                }
            })

            if (data.LoggedById && (data.log === "cli_token_exchange" || data.log.startsWith("mcp_connected"))) {
                const userId = data.LoggedById;
                const work = Promise.resolve().then(async () => {
                    const { sendFirstAgentConnectedEmail } = await import("@/lib/onboarding/agentConnection");
                    await sendFirstAgentConnectedEmail(userId, allLogs.id);
                }).catch(() => console.error("Agent connection email scheduling failed"));
                try { waitUntil(work); } catch { void work; }
            }

            return ({
                status:200,
                json:allLogs
            })
            // res.status(200).json(comments);
        } catch (error) {
            console.log(error);
            return ({
                status:500,
                json:[],
                error:error
            })
            // res.status(500).json({ message: "Internal server error" });
        }

};

export default createLog;