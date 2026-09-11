import { columnRoleFor } from '@/lib/mcp/boards/columnRole';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { lockAgentMutationFence } from '@/lib/mcp/tasks/agentMutationFence';
import { FactoryAcceptanceError, actorCanTransition, requireCurrentContract, requireAssignedQa, destination, enrolled, enrollment, fail, type FactoryTx } from './enforcement';
export type Identity = {
    userId: number;
    agentId?: string | null;
};
const int = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
        fail('factory_invalid_request', 'Positive integer identity required.', 400);
    return value as number;
};
const text = (value: unknown, pattern: RegExp) => {
    if (typeof value !== 'string' || !pattern.test(value))
        fail('factory_invalid_request', 'Invalid identifier or digest.', 400);
    return value as string;
};
const digest = (value: unknown) => text(value, /^[a-f0-9]{64}$/);
const sha = (value: unknown) => text(value, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const actorId = (value: unknown) => text(value, /^[A-Za-z0-9-]{1,128}$/);
const instant = (value: unknown) => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        fail('factory_invalid_request', 'Task revision must be its exact ISO timestamp.', 400);
    return new Date(value as string);
};
const json = (value: unknown) => value as Prisma.InputJsonValue;
async function owner(tx: FactoryTx, projectId: number, identity: Identity) {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { ownerId: true } });
    if (identity.agentId || project?.ownerId !== identity.userId)
        fail('factory_owner_required', 'Only the project owner can enroll agents or approve criteria.', 403);
}
async function authority(tx: FactoryTx, projectId: number, identity: Identity) {
    const policy = await enrollment(tx, projectId);
    if (!enrolled(policy, identity.agentId) || policy!.agentRoles[identity.agentId!] !== 'authority')
        fail('factory_authority_required', 'An enrolled acceptance authority is required.', 403);
    return policy!;
}
async function task(tx: FactoryTx, projectId: number, taskId: number) {
    await lockAgentMutationFence(tx, taskId);
    const value = await tx.task.findUnique({ where: { id: taskId } });
    if (!value || value.projectId !== projectId || value.status !== 'Normal')
        fail('factory_task_scope_mismatch', 'The task is not active in this project.', 409);
    return value;
}
export async function configureEnrollment(tx: FactoryTx, body: any, identity: Identity) {
    const projectId = int(body.project_id);
    await owner(tx, projectId, identity);
    const previous = await enrollment(tx, projectId);
    if (body.expected_version !== (previous?.version ?? 0))
        fail('factory_enrollment_changed', 'Enrollment changed; reload before updating.');
    if (typeof body.enabled !== 'boolean' || !body.agent_roles || Array.isArray(body.agent_roles) || typeof body.agent_roles !== 'object')
        fail('factory_invalid_request', 'Explicit enrollment configuration required.', 400);
    const entries = Object.entries(body.agent_roles);
    if (!entries.length || entries.length > 100 || !entries.some(([, role]) => role === 'authority'))
        fail('factory_invalid_request', 'Enrollment requires bounded agents and an authority.', 400);
    for (const [id, role] of entries) {
        actorId(id);
        if (!['authority', 'dev', 'qa', 'recovery'].includes(role as string))
            fail('factory_invalid_request', 'Unknown factory role.', 400);
        const agent = await tx.agent.findUnique({ where: { id }, select: { userId: true, revokedAt: true } });
        if (!agent || agent.userId !== identity.userId || agent.revokedAt)
            fail('factory_agent_scope_mismatch', 'Enrolled agents must be active identities owned by the project owner.', 403);
    }
    const sections: Record<string, number[]> = {};
    const all = new Set<number>();
    for (const target of ['qa', 'done', 'waiting', 'handoff']) {
        const ids = body.sections?.[target];
        if (!Array.isArray(ids) || !ids.length || ids.length > 20)
            fail('factory_invalid_request', 'Each protected transition requires section IDs.', 400);
        sections[target] = ids.map(int);
        for (const id of sections[target]) {
            if (all.has(id))
                fail('factory_invalid_request', 'Protected sections must be distinct.', 400);
            all.add(id);
            if (!await tx.section.findFirst({ where: { id, projectId } }))
                fail('factory_section_scope_mismatch', 'Section is outside the enrolled project.', 400);
        }
    }
    const data = { enabled: body.enabled, version: (previous?.version ?? 0) + 1, agentRoles: json(body.agent_roles), sections: json(sections) };
    const result = await tx.factoryEnrollment.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    await tx.factoryGrant.deleteMany({ where: { projectId, consumedAt: null } });
    await tx.factoryTransitionRequest.updateMany({ where: { projectId, status: { in: ['pending', 'granted'] } }, data: { status: 'superseded' } });
    return { enrollment: result };
}
export async function registerRevision(tx: FactoryTx, body: any, identity: Identity) {
    const projectId = int(body.project_id), taskId = int(body.task_id);
    await task(tx, projectId, taskId);
    const policy = await authority(tx, projectId, identity);
    const contract = await tx.factoryContract.findFirst({ where: { taskId, projectId }, orderBy: { version: 'desc' } });
    if (!contract || contract.version !== int(body.contract_version))
        fail('factory_contract_changed', 'The approved contract is missing or superseded.');
    await requireCurrentContract(tx,taskId,contract.version);
    const previous = await tx.factoryRevision.findUnique({ where: { taskId } });
    const codeRevision = sha(body.code_revision), writer = actorId(body.active_writer_agent_id);
    if (policy.agentRoles[writer] !== 'dev')
        fail('factory_writer_mismatch', 'Active writer must be an enrolled implementer.', 403);
    if (!Array.isArray(body.implementer_agent_ids) || body.implementer_agent_ids.length > 100)
        fail('factory_invalid_request', 'Implementer identities are required.', 400);
    const implementers = [...new Set<string>([writer, ...body.implementer_agent_ids.map(actorId), ...(previous?.implementerAgentIds as string[] ?? [])])].sort();
    if (implementers.some(id => policy.agentRoles[id] !== 'dev'))
        fail('factory_writer_mismatch', 'Implementers must be enrolled developer identities.', 403);
    if (previous?.contractVersion === contract.version && previous.codeRevision === codeRevision && previous.activeWriterAgentId === writer && JSON.stringify(previous.implementerAgentIds) === JSON.stringify(implementers))
        return { revision: previous };
    if (body.expected_code_revision !== (previous?.codeRevision ?? null))
        fail('factory_revision_changed', 'The registered code revision changed.');
    const data = { projectId, contractVersion: contract.version, codeRevision, activeWriterAgentId: writer, implementerAgentIds: json(implementers), epoch: (previous?.epoch ?? 0) + 1 };
    const revision = await tx.factoryRevision.upsert({ where: { taskId }, create: { taskId, ...data }, update: data });
    await tx.factoryGrant.deleteMany({ where: { taskId, consumedAt: null } });
    await tx.factoryTransitionRequest.updateMany({ where: { taskId, status: { in: ['pending', 'granted'] } }, data: { status: 'superseded' } });
    return { revision };
}
export async function registerRequest(tx: FactoryTx, body: any, identity: Identity, now = new Date()) {
    const projectId = int(body.project_id), taskId = int(body.task_id), targetSectionId = int(body.target_section_id);
    const current = await task(tx, projectId, taskId), policy = await enrollment(tx, projectId);
    if (!enrolled(policy, identity.agentId))
        fail('factory_actor_denied', 'An enrolled worker identity is required.', 403);
    const target = destination(policy!, targetSectionId);
    if (!target || !actorCanTransition(policy!, identity.agentId!, target))
        fail('factory_actor_denied', 'The worker cannot request this transition.', 403);
    const expected = instant(body.expected_task_revision);
    if (current.updatedAt?.getTime() !== expected.getTime())
        fail('factory_task_changed', 'Task changed before the request.');
    const revision = await tx.factoryRevision.findUnique({ where: { taskId } });
    if (!revision || revision.projectId !== projectId)
        fail('factory_contract_required', 'Register an approved contract and revision first.');
    await requireCurrentContract(tx, taskId, revision.contractVersion);
    await requireAssignedQa(tx, policy!, taskId, identity.agentId!, revision.implementerAgentIds as string[]);
    if (target === 'done' && (revision.implementerAgentIds as string[]).includes(identity.agentId!))
        fail('factory_independent_qa_required', 'An implementer cannot request independent QA completion.', 403);
    const requestKey = createHash('sha256').update(JSON.stringify([projectId, taskId, identity.agentId, targetSectionId, expected.toISOString(), policy!.version, revision.contractVersion, revision.epoch])).digest('hex');
    const request = await tx.factoryTransitionRequest.upsert({ where: { requestKey }, update: {}, create: { id: randomUUID(), requestKey, enrollmentVersion: policy!.version, projectId, taskId, actorAgentId: identity.agentId!, targetSectionId, expectedTaskRevision: expected, contractVersion: revision.contractVersion, codeRevision: revision.codeRevision, revisionEpoch: revision.epoch } });
    if (request.status === 'granted' && request.grantId) {
        const previousGrant = await tx.factoryGrant.findUnique({ where: { id: request.grantId } });
        if (previousGrant && !previousGrant.consumedAt && previousGrant.expiresAt <= now) {
            return { request: await tx.factoryTransitionRequest.update({ where: { id: request.id }, data: { status: 'pending' } }) };
        }
    }
    return { request };
}
export async function registerGrant(tx: FactoryTx, body: any, identity: Identity, now = new Date()) {
    const projectId = int(body.project_id), taskId = int(body.task_id);
    const current = await task(tx, projectId, taskId), policy = await authority(tx, projectId, identity);
    const actor = actorId(body.actor_agent_id), targetSectionId = int(body.target_section_id), target = destination(policy, targetSectionId);
    if (!target || !actorCanTransition(policy, actor, target))
        fail('factory_actor_denied', 'Grant actor is not enrolled for this destination.', 403);
    const revision = await tx.factoryRevision.findUnique({ where: { taskId } });
    if (!revision || revision.projectId !== projectId || revision.contractVersion !== int(body.contract_version) || revision.codeRevision !== sha(body.code_revision))
        fail('factory_revision_changed', 'Grant must match the current registered contract and code revision.');
    await requireCurrentContract(tx, taskId, revision.contractVersion);
    await requireAssignedQa(tx, policy, taskId, actor, revision.implementerAgentIds as string[]);
    if (target === 'done' && (revision.implementerAgentIds as string[]).includes(actor))
        fail('factory_independent_qa_required', 'QA must be independent of every implementer.', 403);
    if (target !== 'done' && policy.agentRoles[actor] === 'dev' && revision.activeWriterAgentId !== actor)
        fail('factory_writer_mismatch', 'Grant must belong to the active writer.');
    const expected = instant(body.expected_task_revision), authorizationId = text(body.authorization_id, /^[A-Za-z0-9_.:-]{1,128}$/), evidenceDigest = digest(body.evidence_digest);
    const request = await tx.factoryTransitionRequest.findUnique({ where: { id: actorId(body.request_id) } });
    if (!request || request.projectId !== projectId || request.taskId !== taskId || request.actorAgentId !== actor || request.targetSectionId !== targetSectionId || request.enrollmentVersion !== policy.version || request.revisionEpoch !== revision.epoch || request.expectedTaskRevision.getTime() !== expected.getTime())
        fail('factory_request_mismatch', 'Grant must reference the worker request for this exact transition.');
    const ttl = int(body.ttl_seconds);
    if (ttl > 300)
        fail('factory_invalid_request', 'Grants expire within 300 seconds.', 400);
    const existing = await tx.factoryGrant.findUnique({ where: { projectId_authorizationId: { projectId, authorizationId } } });
    if (existing) {
        if (existing.requestId !== request.id || existing.taskId !== taskId || existing.actorAgentId !== actor || existing.targetSectionId !== targetSectionId || existing.codeRevision !== revision.codeRevision || existing.contractVersion !== revision.contractVersion || existing.evidenceDigest !== evidenceDigest || existing.expectedTaskRevision.getTime() !== expected.getTime() || existing.authorityAgentId !== identity.agentId || existing.enrollmentVersion !== policy.version || existing.revisionEpoch !== revision.epoch)
            fail('factory_authorization_conflict', 'Authorization ID was already used for different evidence.');
        if (!existing.consumedAt && existing.expiresAt.getTime() <= now.getTime()) {
            if (current.updatedAt?.getTime() !== expected.getTime() || !['pending', 'granted'].includes(request.status) || request.grantId !== existing.id)
                fail('factory_task_changed', 'Expired grant cannot renew after task or request changes.');
            const grant = await tx.factoryGrant.update({ where: { id: existing.id }, data: { expiresAt: new Date(now.getTime() + ttl * 1000) } });
            await tx.factoryTransitionRequest.update({ where: { id: request.id }, data: { status: 'granted' } });
            return { grant };
        }
        return { grant: existing };
    }
    if (current.updatedAt?.getTime() !== expected.getTime() || request.status !== 'pending')
        fail('factory_task_changed', 'Task or transition request changed before authorization.');
    const grant = await tx.factoryGrant.create({ data: { id: randomUUID(), requestId:request.id, authorizationId, projectId, taskId, actorAgentId: actor, authorityAgentId: identity.agentId!, enrollmentVersion: policy.version, contractVersion: revision.contractVersion, revisionEpoch: revision.epoch, codeRevision: revision.codeRevision, targetSectionId, expectedTaskRevision: expected, evidenceDigest, expiresAt: new Date(now.getTime() + ttl * 1000) } });
    await tx.factoryTransitionRequest.update({ where: { id: request.id }, data: { status: 'granted', grantId: grant.id } });
    return { grant };
}
export async function listRequests(tx: FactoryTx, projectId: number, identity: Identity, cursor?: string) {
    int(projectId);
    await authority(tx, projectId, identity);
    const rows = await tx.factoryTransitionRequest.findMany({ where: { projectId, status: 'pending' }, orderBy: { id: 'asc' }, take: 101, ...(cursor ? { cursor: { id: actorId(cursor) }, skip: 1 } : {}) });
    return { requests: rows.slice(0, 100), next_cursor: rows.length > 100 ? rows[99].id : null };
}
export async function readStatus(tx: FactoryTx, projectId: number, taskId: number, identity: Identity, requestId?: string) {
    int(projectId);
    int(taskId);
    const current = await task(tx, projectId, taskId);
    const policy = await enrollment(tx, projectId);
    if (!enrolled(policy, identity.agentId))
        await owner(tx, projectId, identity);
    const contract = await tx.factoryContract.findFirst({ where: { taskId, projectId }, orderBy: { version: 'desc' } });
    const revision = await tx.factoryRevision.findUnique({ where: { taskId } });
    const requests = await tx.factoryTransitionRequest.findMany({ where: { taskId, projectId, ...(policy?.agentRoles[identity.agentId!] === 'authority' || !identity.agentId ? {} : { actorAgentId: identity.agentId! }) }, orderBy: { createdAt: 'desc' }, take: 20 });
    const grants = await tx.factoryGrant.findMany({ where: { taskId, projectId, ...(policy?.agentRoles[identity.agentId!] === 'authority' || !identity.agentId ? {} : { actorAgentId: identity.agentId! }) }, orderBy: { createdAt: 'desc' }, take: 20 });
    const request = requestId ? await tx.factoryTransitionRequest.findFirst({ where: { id: actorId(requestId), taskId, projectId, ...(policy?.agentRoles[identity.agentId!] === 'authority' || !identity.agentId ? {} : { actorAgentId: identity.agentId! }) } }) : null;
    const grant = request?.grantId ? await tx.factoryGrant.findFirst({where:{id:request.grantId,requestId:request.id,taskId,projectId,...(policy?.agentRoles[identity.agentId!]==='authority'||!identity.agentId?{}:{actorAgentId:identity.agentId!})}}) : null;
    const section = current.sectionId ? await tx.section.findUnique({ where: { id: current.sectionId } }) : null;
    const assignments = await tx.assignees.findMany({ where: { taskId, agentId: { not: null } }, select: { agentId: true } });
    const assignedAgents = [...new Set(assignments.map(a => a.agentId!))].sort().map(agentId => ({ agentId, role: policy?.agentRoles[agentId] ?? null }));
    const template=await tx.factoryTemplate.findFirst({where:{projectId},orderBy:{version:'desc'}});
    const semanticReceipt=await tx.factorySemanticReceipt.findFirst({where:{taskId,projectId},orderBy:{version:'desc'}});
    let binding:{state:'ready'|'unmet';reason:string|null}={state:'unmet',reason:'factory_contract_required'};
    if(contract){try{await requireCurrentContract(tx,taskId,contract.version);binding={state:'ready',reason:null};}catch(error){if(!(error instanceof FactoryAcceptanceError))throw error;binding={state:'unmet',reason:error.code};}}
    return { template, semanticReceipt, binding, enrollment: policy, task: { id: current.id, projectId: current.projectId, updatedAt: current.updatedAt, sectionId: current.sectionId, section: section ? { id: section.id, title: section.section_title, role: columnRoleFor(section) } : null, assignedAgents, status: current.status }, contract, revision, request, grant, requests, grants };
}
