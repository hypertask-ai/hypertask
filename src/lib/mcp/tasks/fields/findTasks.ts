import prisma from '@/lib/prisma';
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes';

// Helper function to find tasks by different identification methods
export async function findTasksByIdentifier(
    user: { id: number },
    options: {
        task_id?: number | number[] | null
        ticket_number?: string | string[] | null
        unique_index?: number | null
        project_id?: number | null
    },
    agentId?: string | null
) {
    const { task_id, ticket_number, unique_index, project_id } = options

    const orConditions: any[] = []

    if (task_id) {
        const taskIds = Array.isArray(task_id) ? task_id : [task_id]
        const validTaskIds = taskIds.filter(id => id && !isNaN(Number(id))).map(id => Number(id))
        if (validTaskIds.length > 0) {
            orConditions.push({ id: { in: validTaskIds } })
        }
    }

    if (ticket_number) {
        const ticketNumbers = Array.isArray(ticket_number) ? ticket_number : [ticket_number]
        const validTicketNumbers = ticketNumbers.filter(t => t && typeof t === 'string' && t.length > 0)
        if (validTicketNumbers.length > 0) {
            const ticketCondition: any = { ticketNumber: { in: validTicketNumbers } }
            if (project_id) {
                ticketCondition.projectId = project_id
            }
            orConditions.push(ticketCondition)
        }
    }

    if (unique_index !== null && unique_index !== undefined && project_id !== null && project_id !== undefined) {
        orConditions.push({
            projectId: project_id,
            uniqueIndex: unique_index,
            status: { not: 'Deleted' }
        })
    }

    if (orConditions.length === 0) {
        return []
    }

    // Resolve tasks the same way move/get do (see resolveTask.ts): explicit
    // task_id / ticket_number lookups must reach Deleted-status tasks too, so a
    // soft-deleted ticket can still be archived/restored. Only the unique_index
    // arm excludes Deleted (its own condition above). Without this, a Deleted
    // task resolved to no rows, the response omitted `task`, and the CLI/MCP
    // null-deref'd on `.ticketNumber` (HTPR-3801).
    const tasks = await prisma.task.findMany({
        where: {
            OR: orConditions,
            project: getProjectWhere(user.id, agentId)
        },
        select: { id: true, sectionId: true, projectId: true, status: true }
    })

    return tasks
}
