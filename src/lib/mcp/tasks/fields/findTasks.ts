import { findIdParamOutOfRange } from '@/lib/mcp/listParams';
import { TaskIdentifierOutOfRangeError } from '@/lib/mcp/tasks/resolveTask';
import prisma from '@/lib/prisma';
import { getProjectWhere } from '@/utils/controllers/projects/getAllIncludes';

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

    const outOfRange = findIdParamOutOfRange({ task_id, unique_index, project_id })
    if (outOfRange) throw new TaskIdentifierOutOfRangeError(outOfRange)

    const orConditions: any[] = []

    if (task_id) {
        const taskIds = Array.isArray(task_id) ? task_id : [task_id]
        const validTaskIds = taskIds.filter(id => id && !isNaN(Number(id))).map(id => Number(id))
        if (findIdParamOutOfRange({ task_id: validTaskIds })) throw new TaskIdentifierOutOfRangeError('task_id')
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

    const tasks = await prisma.task.findMany({
        where: {
            OR: orConditions,
            project: getProjectWhere(user.id, agentId)
        },
        select: { id: true, sectionId: true, projectId: true, status: true }
    })

    return tasks
}
