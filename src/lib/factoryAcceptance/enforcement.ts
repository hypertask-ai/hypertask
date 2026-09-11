import { createHash } from 'node:crypto';
import { columnRoleFor } from '@/lib/mcp/boards/columnRole';
import type { Prisma } from '@prisma/client';
export class FactoryAcceptanceError extends Error {
    request?: {
        project_id: number;
        task_id: number;
        target_section_id: number;
        expected_task_revision: string;
    };
    constructor(public code: string, message: string, public status = 409, public requestId?: string) {
        super(message);
        this.name = 'FactoryAcceptanceError';
    }
}
export function fail(code: string, message: string, status = 409): never {
    throw new FactoryAcceptanceError(code, message, status);
}
export type FactoryTx = Prisma.TransactionClient;
export type Enrollment = {
    projectId: number;
    enabled: boolean;
    version: number;
    agentRoles: Record<string, string>;
    sections: Record<string, number[]>;
};
const PROJECT_LOCK = 1213482326;
// The preview flag gates setup and authority APIs. Once an owner enables a
// policy, its safety checks persist until that owner explicitly disables it.
export async function enrollment(tx: FactoryTx, projectId: number): Promise<Enrollment | null> {
    await tx.$executeRaw `SELECT pg_advisory_xact_lock(${PROJECT_LOCK}::int, ${projectId}::int)`;
    return await tx.factoryEnrollment.findUnique({ where: { projectId } }) as Enrollment | null;
}
export const enrolled = (policy: Enrollment | null, actor?: string | null) => !!(policy?.enabled && actor && Object.hasOwn(policy.agentRoles, actor));
export function destination(policy: Enrollment, sectionId: number | null | undefined) {
    return Object.entries(policy.sections).find(([, ids]) => sectionId != null && ids.includes(sectionId))?.[0] ?? null;
}
export function actorCanTransition(policy: Enrollment, actor: string, target: string) {
    const role = policy.agentRoles[actor];
    return target === 'done' ? role === 'qa' : target === 'qa' ? ['dev', 'recovery'].includes(role) : ['dev', 'qa', 'recovery'].includes(role);
}
export const semanticContentDigest = (task:any) => createHash('sha256').update(JSON.stringify({title:task.title??null,description:task.description_?.content??task.description??null,acceptanceCriteria:task.acceptanceCriteria??null,verifyCommand:task.verifyCommand??null})).digest('hex');

export async function requireCurrentContract(tx: FactoryTx, taskId: number, contractVersion: number) {
    const contract = await tx.factoryContract.findFirst({ where: { taskId }, orderBy: { version: 'desc' } });
    if (!contract || contract.version !== contractVersion)
        fail('factory_contract_changed', 'The registered revision must match the latest approved contract.');
    const template=await tx.factoryTemplate.findFirst({where:{projectId:contract.projectId},orderBy:{version:'desc'}});
    const receipt=await tx.factorySemanticReceipt.findFirst({where:{taskId,projectId:contract.projectId},orderBy:{version:'desc'}});
    if(!template||!receipt||contract.templateVersion!==template.version||contract.semanticVersion!==receipt.version)
        fail('factory_binding_required','Bind the current owner-approved template and semantic requirements before acceptance.');
    const project=await tx.project.findUnique({where:{id:contract.projectId},select:{ownerId:true}});
    const task=await tx.task.findUnique({where:{id:taskId},include:{description_:{select:{content:true}}}});
    if(project?.ownerId!==template.ownerId||project?.ownerId!==receipt.ownerId||!task||receipt.taskContentDigest!==semanticContentDigest(task))
        fail('factory_semantics_unmet','Current owner approval of the semantic requirements is missing or stale.');
}

export async function requireTransitionQa(tx:FactoryTx,policy:Enrollment,taskId:number,actor:string,implementers:string[],target:string){
    const qaActor=policy.agentRoles[actor]==='qa';
    if(target==='done'&&!qaActor)
        fail('factory_actor_denied','Only independent QA can complete factory work.',403);
    // Submission queues and blocked-work handoffs precede QA ownership.
    // Every action taken as QA, and every Done transition, needs its assignment.
    if(qaActor){
        if(implementers.includes(actor))
            fail('factory_independent_qa_required','QA must be independent of every implementer.',403);
        if(!await tx.assignees.findFirst({where:{taskId,agentId:actor}}))
            fail('factory_qa_assignment_required','QA must be assigned to this task.',403);
    }
}
// Caller holds the task mutation fence. The project lock serializes opt-in changes.
export async function guardFactoryMutation(tx: FactoryTx, current: any, patch: any, actor?: string | null, now = new Date(), requested = patch): Promise<{
    grantId?: string;
    replay?: boolean;
}> {
    // Human writes keep their existing behavior, but invalidate pending grants.
    if (!actor) {
        await tx.factoryGrant.deleteMany({ where: { taskId: current.id, consumedAt: null } });
        await tx.factoryTransitionRequest.updateMany({ where: { taskId: current.id, status: { in: ['pending', 'granted'] } }, data: { status: 'superseded' } });
        return {};
    }
    const targetProject = patch.projectId ?? current.projectId;
    const policies = new Map<number, Enrollment | null>();
    for (const id of [...new Set<number>([current.projectId, targetProject])].sort((a, b) => a - b)) {
        policies.set(id, await enrollment(tx, id));
    }
    const policy = policies.get(current.projectId)!;
    if (!enrolled(policy, actor) && !enrolled(policies.get(targetProject)!, actor))
        return {};
    if (targetProject !== current.projectId)
        fail('factory_project_change_denied', 'Factory agents cannot relocate protected work.');
    if (!policy)
        fail('factory_enrollment_required', 'Factory enrollment is unavailable.');
    if (patch.status !== undefined && patch.status !== current.status) {
        fail('factory_lifecycle_denied', 'Factory agents cannot archive, delete or restore protected work.');
    }
    for (const field of ['acceptanceCriteria', 'verifyCommand']) {
        if (patch[field] !== undefined && patch[field] !== current[field])
            fail('factory_contract_owner_required', 'Only the project owner can change acceptance criteria.', 403);
    }
    if (['title','description'].some(field=>requested[field]!==undefined && requested[field] !== (field==='description' ? current.description_?.content??current.description : current[field]))) {
        const semanticReceipt=await tx.factorySemanticReceipt.findFirst({where:{taskId:current.id,projectId:current.projectId},orderBy:{version:'desc'}});
        if(semanticReceipt)fail('factory_scope_owner_required','Only the owner can revise approved task scope. Record implementation updates in comments.',403);
    }
    const targetId = patch.sectionId !== undefined ? patch.sectionId : current.sectionId;
    // The controller may retain the current ID while accepting a new name.
    // Validate that explicit name even when the ID itself did not change.
    if (requested.section !== undefined) {
        if (targetId == null) {
            if (requested.section !== null && requested.section !== '')
                fail('factory_section_identity_required', 'An unassigned task cannot name a completion or review section.');
        } else {
            const namedSection=await tx.section.findFirst({where:{id:targetId,projectId:current.projectId}});
            if (!namedSection || requested.section !== namedSection.section_title)
                fail('factory_section_identity_mismatch', 'The section name must match its section ID.');
        }
    }
    const target = destination(policy, targetId);
    if (!target && targetId != null && targetId !== current.sectionId) {
        const section = await tx.section.findUnique({ where: { id: targetId } });
        if (section && ['done', 'human-review'].includes(columnRoleFor(section)))
            fail('factory_destination_unconfigured', 'The owner must map this review or completion column before factory use.');
    }
    if (targetId === current.sectionId) {
        // A retry after a committed protected move is a no-op only for that actor
        // and the exact unchanged task revision. Never replay an older episode.
        if (target && requested.sectionId !== undefined) {
            const receipt = await tx.factoryGrant.findFirst({ where: { taskId: current.id, actorAgentId: actor,
                    targetSectionId: targetId, consumedTaskRevision: current.updatedAt, consumedAt: { not: null } }, orderBy: { consumedAt: 'desc' } });
            if (receipt && Object.keys(requested).every(k => ['id', 'sectionId', 'section', 'ranking', 'updatedAt', 'projectId', 'uniqueIndex', 'ticketNumber', 'parentTaskId', 'cycleId'].includes(k)))
                return { replay: true };
        }
        return {};
    }
    if (!target) {
        // Return-to-work is allowed; it invalidates any still-pending authorization.
        await tx.factoryGrant.deleteMany({ where: { taskId: current.id, consumedAt: null } });
        await tx.factoryTransitionRequest.updateMany({ where: { taskId: current.id, status: { in: ['pending', 'granted'] } }, data: { status: 'superseded' } });
        return {};
    }
    if (!actorCanTransition(policy, actor, target))
        fail('factory_actor_denied', 'This factory role cannot perform the requested transition.', 403);
    const revision = await tx.factoryRevision.findUnique({ where: { taskId: current.id } });
    if (!revision || revision.projectId !== current.projectId)
        fail('factory_contract_required', 'Register acceptance criteria and a code revision first.');
    await requireCurrentContract(tx, current.id, revision.contractVersion);
    const implementers = revision.implementerAgentIds as string[];
    await requireTransitionQa(tx, policy, current.id, actor, implementers, target);
    if (target === 'done' && implementers.includes(actor))
        fail('factory_independent_qa_required', 'An implementer cannot authorize independent QA.');
    if (target !== 'done' && policy.agentRoles[actor] === 'dev' && revision.activeWriterAgentId !== actor)
        fail('factory_writer_mismatch', 'Only the active writer can submit this transition.');
    const grant = await tx.factoryGrant.findFirst({ where: { taskId: current.id, projectId: current.projectId,
            actorAgentId: actor, targetSectionId: targetId!, consumedAt: null,
            enrollmentVersion: policy.version, contractVersion: revision.contractVersion, revisionEpoch: revision.epoch,
            codeRevision: revision.codeRevision, expectedTaskRevision: current.updatedAt, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } });
    if (!grant) {
        const error = new FactoryAcceptanceError('factory_acceptance_required', 'A current acceptance grant is required for this transition.');
        if (current.updatedAt)
            error.request = { project_id: current.projectId, task_id: current.id, target_section_id: targetId!, expected_task_revision: current.updatedAt.toISOString() };
        throw error;
    }
    const consumed = await tx.factoryGrant.updateMany({ where: { id: grant.id, consumedAt: null }, data: { consumedAt: now, consumedTaskRevision: patch.updatedAt } });
    if (consumed.count !== 1)
        fail('factory_grant_conflict', 'The acceptance grant was already consumed.');
    const request = await tx.factoryTransitionRequest.updateMany({where:{id:grant.requestId,grantId:grant.id,status:{in:['pending','granted']}},data:{status:'consumed'}});
    if (request.count !== 1) fail('factory_request_conflict', 'The linked transition request is no longer current.');
    return { grantId: grant.id };
}
export async function guardFactoryCreate(tx: FactoryTx, projectId: number, sectionId: number, actor?: string | null) {
    if (!actor)
        return;
    const policy = await enrollment(tx, projectId);
    const section = enrolled(policy, actor) ? await tx.section.findUnique({ where: { id: sectionId } }) : null;
    if (enrolled(policy, actor) && (destination(policy!, sectionId) || section && ['done', 'human-review'].includes(columnRoleFor(section))))
        fail('factory_create_destination_denied', 'Create factory work in an implementation queue before requesting acceptance.');
}
export async function guardFactoryProjectAdministration(tx: FactoryTx, projectId: number, actor?: string | null) {
    if (!actor)
        return;
    const policy = await enrollment(tx, projectId);
    if (enrolled(policy, actor))
        fail('factory_project_owner_required', 'Only the project owner can change factory columns or board lifecycle.', 403);
}
