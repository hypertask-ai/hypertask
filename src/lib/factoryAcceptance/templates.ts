import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { lockAgentMutationFence } from '@/lib/mcp/tasks/agentMutationFence';
import { enrolled, enrollment, fail, semanticContentDigest, type FactoryTx } from './enforcement';
import type { Identity } from './service';

type Criterion = {id:string;kind:string;phase:'pre_qa'|'final';description:string};
export type OwnerSession = {userId:number;source:'better-auth'|'legacy'};
const positive = (value:unknown):number => {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)fail('factory_invalid_request','A positive integer identity is required.',400);
  return value;
};
const hash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = (value:unknown) => value as Prisma.InputJsonValue;
async function requireOwner(tx:FactoryTx,projectId:number,session:OwnerSession){
  if(!session||!['better-auth','legacy'].includes(session.source))fail('factory_owner_session_required','An authenticated owner session is required.',403);
  const project=await tx.project.findUnique({where:{id:projectId},select:{ownerId:true,status:true}});
  if(project?.ownerId!==session.userId||project.status!=='Normal')fail('factory_owner_required','Only the current project owner can approve factory policy.',403);
}
function criteria(input:unknown,prefix:'policy.'|'scope.'):Criterion[]{
  if(!Array.isArray(input)||!input.length||input.length>100)fail('factory_invalid_request','Explicit bounded criteria are required.',400);
  const ids=new Set<string>();
  return input.map(item=>{
    if(!item||typeof item.id!=='string'||!item.id.startsWith(prefix)||!/^[A-Za-z0-9_.:-]{1,128}$/.test(item.id)||ids.has(item.id)||typeof item.kind!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(item.kind)||!['pre_qa','final'].includes(item.phase)||typeof item.description!=='string'||!item.description.trim()||item.description.length>4000)fail('factory_invalid_request','Invalid or duplicate criterion.',400);
    ids.add(item.id);return {id:item.id,kind:item.kind,phase:item.phase,description:item.description};
  });
}
function appendOnly(previous:unknown,next:Criterion[]){
  if(previous==null)return;
  const byId=new Map(next.map(item=>[item.id,item]));
  if(!Array.isArray(previous)||previous.some(old=>!old||!byId.has(old.id)||['id','kind','phase','description'].some(key=>(byId.get(old.id) as any)[key]!==old[key])))fail('factory_contract_immutable','Approved criteria cannot be removed or changed. Add new criteria with new IDs.');
}
async function invalidate(tx:FactoryTx,where:{projectId?:number;taskId?:number}){
  await tx.factoryGrant.deleteMany({where:{...where,consumedAt:null}});
  await tx.factoryTransitionRequest.updateMany({where:{...where,status:{in:['pending','granted']}},data:{status:'superseded'}});
}
export async function registerTemplate(tx:FactoryTx,body:any,session:OwnerSession){
  const projectId=positive(body.project_id);await requireOwner(tx,projectId,session);await enrollment(tx,projectId);
  const previous=await tx.factoryTemplate.findFirst({where:{projectId},orderBy:{version:'desc'}});
  if(body.expected_version!==(previous?.version??0))fail('factory_template_changed','The approved template changed. Reload before approving.');
  const inventory=criteria(body.criteria,'policy.');
  if(!['implementation','tests'].every(kind=>inventory.some(item=>item.kind===kind&&item.phase==='pre_qa'))||!inventory.some(item=>item.kind==='independent_qa'&&item.phase==='final'))fail('factory_invalid_request','The template requires implementation, tests and independent final QA.',400);
  appendOnly(previous?.criteria,inventory);
  // Unique IDs and appendOnly above prove equal-sized inventories contain the same unchanged criteria.
  if(previous?.ownerId===session.userId&&(previous.criteria as Criterion[]).length===inventory.length)return {template:previous};
  const template=await tx.factoryTemplate.create({data:{projectId,version:(previous?.version??0)+1,criteria:json(inventory),criteriaDigest:hash(inventory),ownerId:session.userId}});
  await invalidate(tx,{projectId});return {template};
}
export async function approveRequirements(tx:FactoryTx,body:any,session:OwnerSession){
  const projectId=positive(body.project_id),taskId=positive(body.task_id);
  await lockAgentMutationFence(tx,taskId);await requireOwner(tx,projectId,session);await enrollment(tx,projectId);
  const task=await tx.task.findUnique({where:{id:taskId},include:{description_:{select:{content:true}}}});
  if(!task||task.projectId!==projectId||task.status!=='Normal')fail('factory_task_scope_mismatch','The task is not active in this project.');
  if(body.expected_task_revision!==(task.updatedAt?.toISOString()??null))fail('factory_task_changed','Review the current task before approving its requirements.');
  if(body.expected_scope_digest!==semanticContentDigest(task))fail('factory_scope_changed','The task scope changed after review. Reload before approving.');
  const previous=await tx.factorySemanticReceipt.findFirst({where:{taskId},orderBy:{version:'desc'}});
  if(body.expected_version!==(previous?.version??0))fail('factory_requirements_changed','The semantic requirement version changed.');
  const inventory=criteria(body.criteria,'scope.');
  if(inventory.every(item=>['implementation','tests','independent_qa'].includes(item.kind)))fail('factory_semantics_required','Explicit product outcomes are required; process checks are not semantic acceptance.',400);
  appendOnly(previous?.criteria,inventory);
  // Unique IDs and appendOnly above prove equal-sized inventories contain the same unchanged criteria.
  if(previous?.ownerId===session.userId&&previous.taskContentDigest===semanticContentDigest(task)&&(previous.criteria as Criterion[]).length===inventory.length)return {semanticReceipt:previous};
  const semanticReceipt=await tx.factorySemanticReceipt.create({data:{taskId,projectId,version:(previous?.version??0)+1,criteria:json(inventory),criteriaDigest:hash(inventory),taskContentDigest:semanticContentDigest(task),sourceTaskRevision:task.updatedAt,ownerId:session.userId}});
  await invalidate(tx,{taskId});return {semanticReceipt};
}
export async function bindTemplate(tx:FactoryTx,body:any,identity:Identity){
  if(Object.keys(body).some(key=>!['project_id','task_id'].includes(key)))fail('factory_binding_input_denied','Binding accepts task identity only, never criteria or selected versions.',400);
  const projectId=positive(body.project_id),taskId=positive(body.task_id);
  await lockAgentMutationFence(tx,taskId);const policy=await enrollment(tx,projectId);
  if(!enrolled(policy,identity.agentId))fail('factory_actor_denied','An enrolled worker identity is required.',403);
  const task=await tx.task.findUnique({where:{id:taskId},include:{description_:{select:{content:true}}}});
  if(!task||task.projectId!==projectId||task.status!=='Normal')fail('factory_task_scope_mismatch','The task is not active in this project.');
  const project=await tx.project.findUnique({where:{id:projectId},select:{ownerId:true}});
  const template=await tx.factoryTemplate.findFirst({where:{projectId},orderBy:{version:'desc'}});
  const receipt=await tx.factorySemanticReceipt.findFirst({where:{taskId,projectId},orderBy:{version:'desc'}});
  if(!template||!receipt)fail('factory_semantics_unmet','An owner-approved template and explicit semantic receipt are required.');
  if(template.ownerId!==project?.ownerId||receipt.ownerId!==project.ownerId)fail('factory_owner_approval_stale','The current owner must approve the template and requirements.');
  if(receipt.taskContentDigest!==semanticContentDigest(task))fail('factory_semantics_unmet','Editable acceptance fields changed after owner approval.');
  const approved=[...(template.criteria as Criterion[]),...(receipt.criteria as Criterion[])];
  const previous=await tx.factoryContract.findFirst({where:{taskId,projectId},orderBy:{version:'desc'}});
  if(previous?.templateVersion===template.version&&previous.semanticVersion===receipt.version)return {contract:previous};
  const merged=new Map<string,Criterion>((previous?.criteria as Criterion[]??[]).map(item=>[item.id,item]));
  for(const item of approved){const old=merged.get(item.id);if(old&&['kind','phase','description'].some(key=>(old as any)[key] !== (item as any)[key]))fail('factory_contract_immutable','Binding cannot replace a previously approved criterion.');merged.set(item.id,item);}
  const inventory=[...merged.values()];
  if(inventory.length>200)fail('factory_invalid_request','The combined contract exceeds 200 criteria.',400);
  appendOnly(previous?.criteria,inventory);
  const contract=await tx.factoryContract.create({data:{taskId,projectId,version:(previous?.version??0)+1,criteria:json(inventory),criteriaDigest:hash(inventory),ownerId:template.ownerId,templateVersion:template.version,semanticVersion:receipt.version}});
  await invalidate(tx,{taskId});return {contract};
}
export async function readOwnerPolicy(tx:FactoryTx,projectId:number,taskId:number|undefined,session:OwnerSession){
  positive(projectId);await requireOwner(tx,projectId,session);
  if(taskId!==undefined){positive(taskId);await lockAgentMutationFence(tx,taskId);}
  const template=await tx.factoryTemplate.findFirst({where:{projectId},orderBy:{version:'desc'}});
  const policy=await enrollment(tx,projectId);
  const enforcementEnabled=policy?.enabled===true;
  if(taskId===undefined)return {projectId,template,semanticReceipt:null,enforcementEnabled};
  const task=await tx.task.findUnique({where:{id:taskId},include:{description_:{select:{content:true}}}});
  if(!task||task.projectId!==projectId)fail('factory_task_scope_mismatch','The task is outside this project.');
  const semanticReceipt=await tx.factorySemanticReceipt.findFirst({where:{taskId,projectId},orderBy:{version:'desc'}});
  const project=await tx.project.findUnique({where:{id:projectId},select:{ownerId:true}});
  const scopeDigest=semanticContentDigest(task);
  const current=!!semanticReceipt&&semanticReceipt.ownerId===project?.ownerId&&semanticReceipt.taskContentDigest===scopeDigest;
  return {projectId,template,semanticReceipt,enforcementEnabled,approval:{state:!semanticReceipt?'missing':current?'current':'stale',reason:!semanticReceipt?'Requirements have not been approved.':current?null:'The saved scope or project owner changed after approval.'},task:{id:task.id,projectId,updatedAt:task.updatedAt,title:task.title,scopeDigest,reviewedScope:{title:task.title??null,description:task.description_?.content??task.description??null,acceptanceCriteria:task.acceptanceCriteria??null,verifyCommand:task.verifyCommand??null}}};
}
