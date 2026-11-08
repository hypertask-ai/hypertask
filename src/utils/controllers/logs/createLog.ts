import { waitUntil } from "@vercel/functions";
import {  CreateLogInput } from "@/models/model";
import { LogType, PrismaClient, Status } from "@prisma/client";

import prisma from "@/lib/prisma";
import { logPersonal } from "@/utils/controllers/logs/quietPersonalLog";


const createLog = async (data: CreateLogInput): Promise<any> => {
    try {

            const allLogs =await prisma.logs.create({
                data:{
                    log:data.log,
                    type:data.type as unknown as LogType,
                    status:data.status as unknown as Status,
                    LoggedById:data.LoggedById

                }
            })
            await logPersonal(data.LoggedById ?? null, "createLog", { logId: allLogs.id, type: String(data.type), status: String(data.status), }, data.log)

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
        } catch (error) {
            console.log(error);
            return ({
                status:500,
                json:[],
                error:error
            })
        }

};

export default createLog;