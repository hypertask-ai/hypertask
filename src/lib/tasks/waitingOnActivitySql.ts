import { Prisma } from "@prisma/client";
import { PRIVATE_AGENT_DISPLAY_NAME } from "@/lib/agents/publicAgent";

export function visibleWaitingOnActivity(
  userId: number,
  projectId: Prisma.Sql,
  activity: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`
    (
      SELECT CASE
        WHEN activity_row.activity->>'type' = 'TaskWaitingOn'
          AND (
            (
              activity_row.activity #>> '{data,waitingOnPrivate}' = 'true'
              AND COALESCE((activity_row.activity #>> '{data,waitingOnAgentOwnerId}')::int, 0) <> ${userId}
            )
            OR EXISTS (
            SELECT 1 FROM "Agent" waiting_agent
            WHERE (
              waiting_agent.id = NULLIF(activity_row.activity #>> '{data,waitingOnAgentId}', '')
              OR (
                NULLIF(activity_row.activity #>> '{data,waitingOnAgentId}', '') IS NULL
                AND waiting_agent.visibility = 'PRIVATE'::"AgentVisibility"
                AND waiting_agent."displayName" <> ''
                AND waiting_agent."displayName" = activity_row.activity #>> '{data,waitingOnDisplayName}'
                AND EXISTS (SELECT 1 FROM "Member" waiting_name_member
                  WHERE waiting_name_member."agentId" = waiting_agent.id
                    AND waiting_name_member."projectId" = ${projectId}
                    AND waiting_name_member.status = 'Accepted'::"InviteStatus")
              )
            )
            AND waiting_agent."userId" <> ${userId}
            AND NOT (waiting_agent.visibility = 'TEAM'::"AgentVisibility" AND EXISTS (
              SELECT 1 FROM "Member" visibility_agent_member
              INNER JOIN "Project" visibility_project ON visibility_project.id = visibility_agent_member."projectId"
              WHERE visibility_agent_member."agentId" = waiting_agent.id
                AND visibility_agent_member."projectId" = ${projectId}
                AND visibility_project.status = 'Normal'::"Status"
                AND (visibility_project."ownerId" = ${userId} OR EXISTS (
                  SELECT 1 FROM "Member" visibility_user_member
                  WHERE visibility_user_member."projectId" = visibility_project.id
                    AND visibility_user_member."userId" = ${userId} AND visibility_user_member."agentId" IS NULL))
            ))
          )
          )
        THEN jsonb_set(
          jsonb_set(activity_row.activity, '{data,waitingOnDisplayName}', to_jsonb(${PRIVATE_AGENT_DISPLAY_NAME}::text), true),
          '{data,waitingOnAgentId}', 'null'::jsonb, true)
        ELSE activity_row.activity
      END
      FROM LATERAL (SELECT ${activity} AS activity) activity_row
    )
  `;
}
