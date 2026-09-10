const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const Module=require('node:module');
const base=path.resolve(__dirname,'../src/lib/factoryAcceptance');
const cache={};
function load(name){
 if(cache[name])return cache[name].exports;
 const filename=path.join(base,name+'.ts'),mod=new Module(filename,module);cache[name]=mod;mod.filename=filename;mod.paths=module.paths;
 mod.require=id=>id==='@/lib/mcp/boards/columnRole'?load('../mcp/boards/columnRole'):id==='./enforcement'?load('enforcement'):id.includes('agentMutationFence')?{lockAgentMutationFence:async(tx,id)=>tx.$executeRaw('task',id)}:require(id);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
 return mod.exports;
}
const {guardFactoryMutation,guardFactoryCreate}=load('enforcement');
const {configureEnrollment,registerContract,registerRevision,registerRequest,registerGrant,readStatus}=load('service');
const now=new Date('2026-09-10T18:00:00.000Z'),code='a'.repeat(40),owner={userId:6},dev={userId:6,agentId:'dev'},qa={userId:6,agentId:'qa'},authority={userId:6,agentId:'authority'};
const eq=(a,b)=>a instanceof Date&&b instanceof Date?a.getTime()===b.getTime():a===b;
function matches(row,where={}){return Object.entries(where).every(([key,value])=>{
 if(key.includes('_') && value && typeof value==='object' && !(key in row))return matches(row,value);
 if(value&&typeof value==='object'&&!(value instanceof Date))return Object.entries(value).every(([op,v])=>op==='not'?!eq(row[key],v):op==='gt'?row[key]>v:op==='in'?v.includes(row[key]):false);
 return eq(row[key],value);
});}
function database(){
 let data={project:[{id:15,ownerId:6},{id:99,ownerId:7}],agent:['dev','qa','authority','recovery','other'].map(id=>({id,userId:6,revokedAt:null})),section:[10,11,12,13,14].map(id=>({id,projectId:15,section_title:id===10?'In Progress':'QA',isDone:false})),task:[{id:1,projectId:15,status:'Normal',sectionId:10,section:'In Progress',updatedAt:now,acceptanceCriteria:'approved'}],assignees:[{taskId:1,agentId:'qa'}],factoryEnrollment:[],factoryContract:[],factoryRevision:[],factoryGrant:[],factoryTransitionRequest:[]};
 const tx={$executeRaw:async()=>{}};
 for(const name of Object.keys(data))tx[name]={
  async findUnique({where}){return data[name].find(r=>matches(r,where))??null;},
  async findUniqueOrThrow(args){const row=await this.findUnique(args);assert.ok(row);return row;},
  async findFirst({where,orderBy}={}){let rows=data[name].filter(r=>matches(r,where));if(orderBy){const [key,direction]=Object.entries(orderBy)[0];rows.sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(direction==='desc'?-1:1));}return rows[0]??null;},
  async findMany({where,take}={}){return data[name].filter(r=>matches(r,where)).slice(0,take??Infinity);},
  async create({data:row}){const stored={createdAt:now,consumedAt:null,consumedTaskRevision:null,status:'pending',grantId:null,...structuredClone(row)};data[name].push(stored);return stored;},
  async update({where,data:patch}){const row=await this.findUnique({where});assert.ok(row);Object.assign(row,patch);return row;},
  async updateMany({where,data:patch}){const rows=data[name].filter(r=>matches(r,where));rows.forEach(r=>Object.assign(r,patch));return {count:rows.length};},
  async deleteMany({where}){const count=data[name].filter(r=>matches(r,where)).length;data[name]=data[name].filter(r=>!matches(r,where));return {count};},
  async upsert({where,create,update}){return await this.findUnique({where})?this.update({where,data:update}):this.create({data:create});},
 };
 let tail=Promise.resolve();
 return {tx,rows:name=>data[name],transaction(fn){const operation=tail.then(async()=>{const before=structuredClone(data);try{return await fn(tx);}catch(e){data=before;throw e;}});tail=operation.catch(()=>{});return operation;}};
}
async function fixture(){
 const db=database();
 await db.transaction(tx=>configureEnrollment(tx,{project_id:15,expected_version:0,enabled:true,agent_roles:{dev:'dev',qa:'qa',authority:'authority',recovery:'recovery'},sections:{qa:[11],done:[12],waiting:[13],handoff:[14]}},owner));
 await db.transaction(tx=>registerContract(tx,{project_id:15,task_id:1,expected_version:0,criteria:[{id:'code',kind:'implementation',phase:'pre_qa',description:'Approved implementation'},{id:'test',kind:'tests',phase:'pre_qa',description:'Required test suite'}]},owner));
 await db.transaction(tx=>registerRevision(tx,{project_id:15,task_id:1,contract_version:1,expected_code_revision:null,code_revision:code,active_writer_agent_id:'dev',implementer_agent_ids:['dev']},authority));
 return db;
}
async function grant(db,actor=dev,target=11){
 const {request}=await db.transaction(tx=>registerRequest(tx,{project_id:15,task_id:1,target_section_id:target,expected_task_revision:now.toISOString()},actor));
 const body={project_id:15,task_id:1,request_id:request.id,contract_version:1,code_revision:code,actor_agent_id:actor.agentId,target_section_id:target,expected_task_revision:now.toISOString(),evidence_digest:'b'.repeat(64),authorization_id:'decision-1',ttl_seconds:60};
 const result=await db.transaction(tx=>registerGrant(tx,body,authority,now));return {...result,body};
}
async function move(db,actor='dev',target=11,at=new Date(now.getTime()+1000),failAfterGuard=false){return db.transaction(async tx=>{
 const current=await tx.task.findUnique({where:{id:1}}),patch={sectionId:target,section:db.rows('section').find(s=>s.id===target)?.section_title??'QA',updatedAt:at};
 const result=await guardFactoryMutation(tx,current,patch,actor,at);
 if(failAfterGuard)throw new Error('Later task write failed');
 if(!result.replay)await tx.task.update({where:{id:1},data:patch});return result;
});}
const rejectsCode=(work,code)=>assert.rejects(work,e=>e.code===code);

test('only human project owner enrolls or approves criteria; authority cannot shrink criteria',async()=>{
 const db=await fixture();
 for(const identity of [dev,authority,{userId:7}])await rejectsCode(db.transaction(tx=>registerContract(tx,{project_id:15,task_id:1,expected_version:1,criteria:[]},identity)),'factory_owner_required');
 await rejectsCode(db.transaction(tx=>configureEnrollment(tx,{project_id:15},dev)),'factory_owner_required');
 assert.equal(db.rows('factoryContract').length,1);
});
test('worker cannot forge authority by supplying actor fields',async()=>{
 const db=await fixture();const {body}=await grant(db);
 await rejectsCode(db.transaction(tx=>registerGrant(tx,{...body,authorization_id:'forged',authority_agent_id:'authority'},dev,now)),'factory_authority_required');
});
test('missing grant rejects task mutation and carries a durable-request registration payload',async()=>{
 const db=await fixture();let denied;
 await assert.rejects(move(db),e=>{denied=e;return e.code==='factory_acceptance_required';});
 assert.equal(db.rows('task')[0].sectionId,10);assert.equal(db.rows('factoryGrant').length,0);
 const {request}=await db.transaction(tx=>registerRequest(tx,denied.request,dev));
 assert.equal(request.actorAgentId,'dev');assert.equal(request.targetSectionId,11);
});
test('grant consumption rolls back with task failure and is single-use with exact retry replay',async()=>{
 const db=await fixture();await grant(db);
 await assert.rejects(move(db,'dev',11,undefined,true),/Later task write failed/);
 assert.equal(db.rows('factoryGrant')[0].consumedAt,null);assert.equal(db.rows('factoryTransitionRequest')[0].status,'granted');assert.equal(db.rows('task')[0].sectionId,10);
 const results=await Promise.all([move(db),move(db)]);
 assert.equal(results.filter(r=>r.grantId).length,1);assert.equal(results.filter(r=>r.replay).length,1);
 assert.equal(db.rows('factoryGrant').filter(r=>r.consumedAt).length,1);
 await db.transaction(tx=>guardFactoryMutation(tx,db.rows('task')[0],{sectionId:10,section:'In Progress',updatedAt:new Date(now.getTime()+2000)},'dev'));
 await db.tx.task.update({where:{id:1},data:{sectionId:10,section:'In Progress',updatedAt:new Date(now.getTime()+2000)}});
 await rejectsCode(move(db),'factory_acceptance_required');
});
test('wrong actor, target, task revision and code revision cannot consume a grant',async()=>{
 const db=await fixture();await grant(db);
 await rejectsCode(move(db,'qa'),'factory_actor_denied');
 await rejectsCode(move(db,'dev',12),'factory_actor_denied');
 await db.tx.task.update({where:{id:1},data:{updatedAt:new Date(now.getTime()+500)}});
 await rejectsCode(move(db),'factory_acceptance_required');
 await db.tx.task.update({where:{id:1},data:{updatedAt:now}});
 await db.transaction(tx=>registerRevision(tx,{project_id:15,task_id:1,contract_version:1,expected_code_revision:code,code_revision:'c'.repeat(40),active_writer_agent_id:'dev',implementer_agent_ids:[]},authority));
 await rejectsCode(move(db),'factory_acceptance_required');
});
test('expired unconsumed grant renews idempotently; consumed grant never renews',async()=>{
 const db=await fixture();const {body}=await grant(db),later=new Date(now.getTime()+61000);
 await rejectsCode(move(db,'dev',11,later),'factory_acceptance_required');
 const renewed=await db.transaction(tx=>registerGrant(tx,body,authority,later));
 assert.equal(db.rows('factoryGrant').length,1);assert.ok(renewed.grant.expiresAt>later);
 await move(db,'dev',11,new Date(later.getTime()+1000));const expiry=renewed.grant.expiresAt;
 const replay=await db.transaction(tx=>registerGrant(tx,body,authority,new Date(later.getTime()+120000)));
 assert.ok(replay.grant.consumedAt);assert.equal(replay.grant.expiresAt.getTime(),expiry.getTime());
});
test('enrolled agents cannot edit criteria, relocate, archive/delete or create protected work',async()=>{
 const db=await fixture(),current=db.rows('task')[0];
 for(const patch of [{acceptanceCriteria:'smaller'},{verifyCommand:'true'},{projectId:99},{status:'Archive'},{status:'Deleted'},{section:'Done'}])await assert.rejects(db.transaction(tx=>guardFactoryMutation(tx,current,patch,'dev')),e=>e.code.startsWith('factory_'));
 await rejectsCode(db.transaction(tx=>guardFactoryCreate(tx,15,12,'dev')),'factory_create_destination_denied');
});
test('humans and unenrolled agents/projects retain task mutation behavior',async()=>{
 const db=await fixture();await grant(db);
 await db.transaction(tx=>guardFactoryMutation(tx,db.rows('task')[0],{sectionId:12,status:'Archive'},null));
 assert.equal(db.rows('factoryGrant').length,0);
 await db.transaction(tx=>guardFactoryMutation(tx,db.rows('task')[0],{sectionId:12},'other'));
 await db.transaction(tx=>guardFactoryMutation(tx,{...db.rows('task')[0],projectId:99},{sectionId:12},'dev'));
 await db.transaction(tx=>guardFactoryCreate(tx,15,12,null));
});
test('approved criterion changes preserve implementer history and invalidate previous grants',async()=>{
 const db=await fixture();await grant(db);
 const criteria=db.rows('factoryContract')[0].criteria;
 await db.transaction(tx=>registerContract(tx,{project_id:15,task_id:1,expected_version:1,criteria},owner));
 await db.transaction(tx=>registerRevision(tx,{project_id:15,task_id:1,contract_version:2,expected_code_revision:code,code_revision:code,active_writer_agent_id:'dev',implementer_agent_ids:[]},authority));
 assert.equal(db.rows('factoryContract').length,2);assert.deepEqual(db.rows('factoryRevision')[0].implementerAgentIds,['dev']);assert.equal(db.rows('factoryGrant').length,0);
 const status=await db.transaction(tx=>readStatus(tx,15,1,authority));assert.equal(status.contract.version,2);assert.equal(status.task.updatedAt.toISOString(),now.toISOString());
});

function controller(db){
 const noEffect=async()=>undefined;
 const generic=new Proxy({__esModule:true,default:noEffect},{get:(obj,key)=>key in obj?obj[key]:noEffect});
 const stubs={
  '@/lib/prisma':{__esModule:true,default:{...db.tx,$transaction:fn=>db.transaction(fn)}},
  '@/lib/factoryAcceptance/enforcement':load('enforcement'),
  '@/lib/factoryAcceptance/service':load('service'),
  '@/lib/mcp/tasks/humanMutationOverride':load('../mcp/tasks/humanMutationOverride'),
  '@/lib/mcp/tasks/agentMutationFence':{AgentMutationLeaseConflictError:class extends Error{},assertAgentAssignmentChangeAllowed:noEffect,cancelAgentMutationLeaseForHumanOverride:noEffect},
  '@/lib/cycleService':{CycleAssignmentError:class extends Error{},assertCycleAssignable:noEffect},
  '@/utils/controllers/projects/getAllIncludes':{taskWriteAccessWhere:()=>({})},
  '@/lib/mcp/webhooks/outbox':{persistBoardWebhookEvent:async()=>[],publishBoardWebhookDeliveries:noEffect},
  '@/lib/agentWebhooks/outbox':{persistAgentTaskUpdatedWebhook:async()=>[],publishAgentWebhookDeliveries:noEffect},
  '../assignees/autoAssignForSection':{autoAssignForSection:async()=> 'ready'},
 };
 const file=path.resolve(base,'../../utils/controllers/tasks/single.ts'),mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;
 mod.require=id=>stubs[id]??(id==='@prisma/client'?require(id):generic);
 mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
 return mod.exports;
}
test('actual central controller persists denied native-move request after rollback',async()=>{
 const db=await fixture();db.rows('section').find(s=>s.id===11).section_title='QA';
 const result=await controller(db).updateTaskSingle({id:1,sectionId:11,section:'QA'},{id:6},'dev');
 assert.equal(result.status,409);assert.equal(result.json.code,'factory_acceptance_required');assert.ok(result.json.request_id);
 assert.equal(db.rows('task')[0].sectionId,10);assert.equal(db.rows('factoryTransitionRequest').length,1);
});
test('expired denial requeues its request for authority polling and supports renewal',async()=>{
 const db=await fixture();const {body}=await grant(db),later=new Date(now.getTime()+61000);
 const pending=await db.transaction(tx=>registerRequest(tx,{project_id:15,task_id:1,target_section_id:11,expected_task_revision:now.toISOString()},dev,later));
 assert.equal(pending.request.status,'pending');
 const renewed=await db.transaction(tx=>registerGrant(tx,body,authority,later));assert.ok(renewed.grant.expiresAt>later);
});
test('enrolled agents cannot create an unmapped Done column escape',async()=>{
 const db=await fixture();db.rows('section').push({id:20,projectId:15,section_title:'Done',isDone:true});
 await rejectsCode(db.transaction(tx=>guardFactoryCreate(tx,15,20,'dev')),'factory_create_destination_denied');
 await rejectsCode(move(db,'dev',20),'factory_destination_unconfigured');
 await rejectsCode(db.transaction(tx=>load('enforcement').guardFactoryProjectAdministration(tx,15,'dev')),'factory_project_owner_required');
 await db.transaction(tx=>load('enforcement').guardFactoryProjectAdministration(tx,15,null));
});

test('status echoes only the scoped request and exposes current section and assigned roles',async()=>{
 const db=await fixture();const {request}=await db.transaction(tx=>registerRequest(tx,{project_id:15,task_id:1,target_section_id:11,expected_task_revision:now.toISOString()},dev));
 const status=await db.transaction(tx=>readStatus(tx,15,1,authority,request.id));
 assert.equal(status.request.id,request.id);assert.deepEqual(status.task.assignedAgents,[{agentId:'qa',role:'qa'}]);assert.equal(status.task.section.title,'In Progress');
 assert.equal((await db.transaction(tx=>readStatus(tx,15,1,authority,'fabricated'))).request,null);
 assert.equal((await db.transaction(tx=>readStatus(tx,15,1,qa,request.id))).request,null);
 db.rows('factoryTransitionRequest')[0].projectId=99;
 assert.equal((await db.transaction(tx=>readStatus(tx,15,1,authority,request.id))).request,null);
});
test('QA waiting requires current assignment at request, grant and consumption without changing writer history',async()=>{
 const db=await fixture(),before=structuredClone(db.rows('factoryRevision')[0]);
 const {body}=await grant(db,qa,13);
 await db.tx.assignees.deleteMany({where:{taskId:1}});
 await rejectsCode(db.transaction(tx=>registerRequest(tx,{project_id:15,task_id:1,target_section_id:13,expected_task_revision:now.toISOString()},qa)),'factory_qa_assignment_required');
 await rejectsCode(db.transaction(tx=>registerGrant(tx,body,authority,now)),'factory_qa_assignment_required');
 await rejectsCode(move(db,'qa',13),'factory_qa_assignment_required');
 await db.tx.assignees.create({data:{taskId:1,agentId:'qa'}});
 await move(db,'qa',13);
 assert.deepEqual(db.rows('factoryRevision')[0],before);
});

test('new approved contract cannot issue requests or grants through the old registered revision',async()=>{
 const db=await fixture();const {body}=await grant(db);
 await db.transaction(tx=>registerContract(tx,{project_id:15,task_id:1,expected_version:1,criteria:[...db.rows('factoryContract')[0].criteria,{id:'new-code',kind:'implementation',phase:'pre_qa',description:'Changed implementation'},{id:'new-tests',kind:'tests',phase:'pre_qa',description:'Changed tests'}]},owner));
 await rejectsCode(db.transaction(tx=>registerRequest(tx,{project_id:15,task_id:1,target_section_id:13,expected_task_revision:now.toISOString()},dev)),'factory_contract_changed');
 await rejectsCode(db.transaction(tx=>registerGrant(tx,body,authority,now)),'factory_contract_changed');
 await rejectsCode(move(db),'factory_contract_changed');
});

function endpoint(db,identity){
 const filename=path.resolve(__dirname,'../src/app/api/mcp/factory/[operation]/route.ts'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
 mod.require=id=>id==='@/lib/prisma'?{__esModule:true,default:{$transaction:fn=>db.transaction(fn)}}:id==='@/lib/mcp/auth'?{checkMcpRateLimit:async()=>null,validateMcpAuth:async()=>identity?{user:{id:identity.userId},agentId:identity.agentId}:null}:id==='@/lib/factoryAcceptance/enforcement'?load('enforcement'):id==='@/lib/factoryAcceptance/service'?load('service'):require(id);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);return mod.exports;
}
test('actual factory endpoint binds authority to auth, rejects anonymous/oversize bodies, and returns scoped status',async()=>{
 const {NextRequest}=require('next/server'),db=await fixture();const {body}=await grant(db);
 const call=(identity,operation,value,query='')=>{const req=new NextRequest('https://example.invalid/api/mcp/factory/'+operation+query,value?{method:'POST',body:JSON.stringify(value),headers:{'Content-Type':'application/json'}}:undefined);return endpoint(db,identity)[value?'POST':'GET'](req,{params:Promise.resolve({operation})});};
 assert.equal((await call(null,'grants',body)).status,401);
 const forged=await call(dev,'grants',{...body,agentId:'authority',userId:6});assert.equal(forged.status,403);assert.equal((await forged.json()).code,'factory_authority_required');
 const status=await call(authority,'status',null,'?project_id=15&task_id=1&request_id='+body.request_id);assert.equal(status.status,200);assert.equal((await status.json()).request.id,body.request_id);
 const large=await call(owner,'contracts',{description:'x'.repeat(256*1024)});assert.equal(large.status,413);
 assert.equal(large.headers.get('cache-control'),'no-store');
});

test('grant wire responses bind requestId and status retains consumed proof after revision changes',async()=>{
 const {NextRequest}=require('next/server'),db=await fixture();const {body,grant:original}=await grant(db);
 const api=endpoint(db,authority);
 const authorize=()=>api.POST(new NextRequest('https://example.invalid/api/mcp/factory/grants',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({operation:'grants'})});
 const issued=await authorize();assert.equal(issued.status,200);assert.equal((await issued.json()).grant.requestId,body.request_id);
 await move(db);
 const replay=await authorize();assert.equal(replay.status,200);const receipt=(await replay.json()).grant;assert.equal(receipt.requestId,body.request_id);assert.ok(receipt.consumedAt);
 await db.transaction(tx=>registerRevision(tx,{project_id:15,task_id:1,contract_version:1,expected_code_revision:code,code_revision:'d'.repeat(40),active_writer_agent_id:'dev',implementer_agent_ids:['dev']},authority));
 // A bounded history must not hide the receipt requested by the reconciler.
 const findMany=db.tx.factoryGrant.findMany;db.tx.factoryGrant.findMany=async()=>[];
 const response=await api.GET(new NextRequest('https://example.invalid/api/mcp/factory/status?project_id=15&task_id=1&request_id='+body.request_id),{params:Promise.resolve({operation:'status'})});
 assert.equal(response.status,200);const status=await response.json();assert.deepEqual(status.grants,[]);assert.equal(status.grant.id,original.id);assert.equal(status.grant.requestId,status.request.id);assert.equal(status.request.status,'consumed');assert.ok(status.grant.consumedAt);assert.notEqual(status.grant.revisionEpoch,status.revision.epoch);
 db.tx.factoryGrant.findMany=findMany;
});

test('actual task controller consumes linked request and status retains it after writer handoff',async()=>{
 const {NextRequest}=require('next/server'),db=await fixture();db.rows('section').find(s=>s.id===14).section_title='Handoff';
 const {body}=await grant(db,dev,14);db.rows('factoryGrant')[0].expiresAt=new Date(Date.now()+300000);
 const result=await controller(db).updateTaskSingle({id:1,sectionId:14,section:'Handoff'},{id:6},'dev');
 assert.equal(result.status,200,JSON.stringify(result));assert.equal(db.rows('factoryTransitionRequest')[0].status,'consumed');
 db.rows('factoryEnrollment')[0].agentRoles.other='dev';
 await db.transaction(tx=>registerRevision(tx,{project_id:15,task_id:1,contract_version:1,expected_code_revision:code,code_revision:code,active_writer_agent_id:'other',implementer_agent_ids:['dev','other']},authority));
 const status=await endpoint(db,authority).GET(new NextRequest('https://example.invalid/api/mcp/factory/status?project_id=15&task_id=1&request_id='+body.request_id),{params:Promise.resolve({operation:'status'})});
 assert.equal(status.status,200);const value=await status.json();assert.equal(value.request.status,'consumed');assert.ok(value.grant.consumedAt);assert.equal(value.revision.activeWriterAgentId,'other');
});

test('owner contract extensions preserve all prior IDs, kinds, phases and descriptions',async()=>{
 const db=await fixture();await grant(db);const original=structuredClone(db.rows('factoryContract')[0].criteria);
 const candidates=[original.slice(0,1),...['id','kind','phase','description'].map(field=>original.map((criterion,index)=>index?criterion:{...criterion,[field]:field==='phase'?'final':'changed'}))];
 for(const criteria of candidates){
  await assert.rejects(db.transaction(tx=>registerContract(tx,{project_id:15,task_id:1,expected_version:1,criteria},owner)),e=>['factory_contract_immutable','factory_invalid_request'].includes(e.code));
  assert.equal(db.rows('factoryContract').length,1);assert.equal(db.rows('factoryGrant').length,1);assert.equal(db.rows('factoryTransitionRequest')[0].status,'granted');
 }
 const result=await db.transaction(tx=>registerContract(tx,{project_id:15,task_id:1,expected_version:1,criteria:[...original,{id:'new-check',kind:'release',phase:'final',description:'Additional owner-approved check'}]},owner));
 assert.equal(result.contract.version,2);assert.deepEqual(result.contract.criteria.slice(0,2),original);
});

test('central controller rejects null and unchanged-ID section name escapes for enrolled workers',async()=>{
 for(const payload of [{sectionId:null,section:'Done'},{section:'Done'},{sectionId:10,section:'Done'}]){
  const db=await fixture();if(payload.sectionId===null)Object.assign(db.rows('task')[0],{sectionId:null,section:''});
  const before=structuredClone(db.rows('task')[0]);const result=await controller(db).updateTaskSingle({id:1,...payload},{id:6},'dev');
  assert.equal(result.status,409);assert.match(result.json.code,/^factory_section_identity/);assert.deepEqual(db.rows('task')[0],before);
 }
 const db=await fixture();const result=await controller(db).updateTaskSingle({id:1,sectionId:10,section:'In Progress'},{id:6},'dev');assert.equal(result.status,200);
 const other=await fixture();const unchanged=await controller(other).updateTaskSingle({id:1,sectionId:10,section:'Legacy display name'},{id:6},'other');assert.equal(unchanged.status,200);
});
