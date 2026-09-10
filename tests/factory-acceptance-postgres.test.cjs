// Exercise the actual acceptance guards and task fence on disposable PostgreSQL.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const net=require('node:net');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const required=process.env.HT_REQUIRE_PG_TESTS==='1';
const container=`factory-acceptance-test-${process.pid}-${Date.now()}`;
let prisma,service,enforcement,fence,templates,unavailable;
const run=(program,args,options={})=>spawnSync(program,args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,...options});
const check=result=>{if(result.status!==0)throw new Error('Disposable PostgreSQL setup command failed');return result.stdout;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
before(async()=>{
 if(run('docker',['version','--format','{{.Server.Version}}']).status!==0){unavailable='Docker unavailable';if(required)throw new Error(unavailable);return;}
 try{
  const port=await freePort(),url=`postgresql://factory_test:factory_test@127.0.0.1:${port}/factory_test`;
  check(run('docker',['run','-d','--name',container,'--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=512m','-e','POSTGRES_USER=factory_test','-e','POSTGRES_PASSWORD=factory_test','-e','POSTGRES_DB=factory_test','-p',`127.0.0.1:${port}:5432`,'postgres:16-alpine']));
  let ready=false;for(let i=0;i<60;i++){if(run('docker',['exec',container,'pg_isready','-U','factory_test','-d','factory_test']).status===0){ready=true;break;}await wait(500);}
  if(!ready)throw new Error('Disposable PostgreSQL did not become ready');
  const schema=check(run(process.execPath,['node_modules/prisma/build/index.js','migrate','diff','--from-empty','--to-schema','src/prisma/schema.prisma','--script'],{cwd:root,env:{...process.env,DATABASE_URL:url}}));
  check(run('docker',['exec','-i',container,'psql','-U','factory_test','-d','factory_test','-v','ON_ERROR_STOP=1'],{input:schema}));
  process.env.DATABASE_URL=url;
  const jiti=require('jiti')(__filename,{interopDefault:true,alias:{'@':path.join(root,'src')}});
  prisma=jiti(path.join(root,'src/lib/prisma.ts')).default;
  service=jiti(path.join(root,'src/lib/factoryAcceptance/service.ts'));
  templates=jiti(path.join(root,'src/lib/factoryAcceptance/templates.ts'));
  enforcement=jiti(path.join(root,'src/lib/factoryAcceptance/enforcement.ts'));
  fence=jiti(path.join(root,'src/lib/mcp/tasks/agentMutationFence.ts'));
 }catch(error){run('docker',['rm','-f',container]);throw error;}
});
after(async()=>{try{if(prisma)await prisma.$disconnect();}finally{run('docker',['rm','-f',container]);}});

async function fixture(){
 const user=await prisma.user.create({data:{uid:`acceptance-test-${Date.now()}-${Math.random()}`,email:'acceptance@example.invalid'}});
 const project=await prisma.project.create({data:{name:`Acceptance transaction ${user.id}`,ownerId:user.id}});
 const dev=await prisma.agent.create({data:{displayName:'Test dev',userId:user.id}});
 const authority=await prisma.agent.create({data:{displayName:'Test authority',userId:user.id}});
 const sections={};for(const name of ['work','qa','done','waiting','handoff'])sections[name]=(await prisma.section.create({data:{projectId:project.id,section_title:name}})).id;
 const task=await prisma.task.create({data:{uniqueIndex:1,updatedAt:new Date(),section:'work',sectionId:sections.work,title:'Test transaction',description:'',projectId:project.id,userId:user.id}});
 const owner={userId:user.id},worker={...owner,agentId:dev.id},auth={...owner,agentId:authority.id};
 await prisma.$transaction(tx=>service.configureEnrollment(tx,{project_id:project.id,expected_version:0,enabled:true,agent_roles:{[dev.id]:'dev',[authority.id]:'authority'},sections:Object.fromEntries(['qa','done','waiting','handoff'].map(name=>[name,[sections[name]]]))},owner));
 await prisma.$transaction(tx=>service.registerContract(tx,{project_id:project.id,task_id:task.id,expected_version:0,criteria:[{id:'implementation',kind:'implementation',phase:'pre_qa',description:'Approved code'},{id:'tests',kind:'tests',phase:'pre_qa',description:'Passing tests'}]},owner));
 const code='a'.repeat(40);
 await prisma.$transaction(tx=>service.registerRevision(tx,{project_id:project.id,task_id:task.id,contract_version:1,expected_code_revision:null,code_revision:code,active_writer_agent_id:dev.id,implementer_agent_ids:[dev.id]},auth));
 const {request}=await prisma.$transaction(tx=>service.registerRequest(tx,{project_id:project.id,task_id:task.id,target_section_id:sections.qa,expected_task_revision:task.updatedAt.toISOString()},worker));
 const {grant}=await prisma.$transaction(tx=>service.registerGrant(tx,{project_id:project.id,task_id:task.id,request_id:request.id,contract_version:1,code_revision:code,actor_agent_id:dev.id,target_section_id:sections.qa,expected_task_revision:task.updatedAt.toISOString(),evidence_digest:'b'.repeat(64),authorization_id:'pg-test',ttl_seconds:300},auth));
 return {task,dev,sections,request,grant};
}

test('PostgreSQL rolls back acceptance and serializes exact retries without reusing old receipts',async t=>{
 if(unavailable)return t.skip(unavailable);
 const f=await fixture();
 const move=(target,{throwAfter=false}={})=>prisma.$transaction(async tx=>{
  await fence.lockAgentMutationFence(tx,f.task.id);
  const current=await tx.task.findUniqueOrThrow({where:{id:f.task.id}});
  const patch={sectionId:target,section:target===f.sections.qa?'qa':'work',updatedAt:new Date(Math.max(Date.now(),current.updatedAt.getTime()+1))};
  const result=await enforcement.guardFactoryMutation(tx,current,patch,f.dev.id);
  if(!result.replay)await tx.task.update({where:{id:f.task.id},data:patch});
  if(throwAfter)throw new Error('Injected failure after task write');
  return result;
 },{timeout:15000});
 await assert.rejects(move(f.sections.qa,{throwAfter:true}),/Injected failure/);
 assert.equal((await prisma.factoryGrant.findUnique({where:{id:f.grant.id}})).consumedAt,null);
 assert.equal((await prisma.factoryTransitionRequest.findUnique({where:{id:f.request.id}})).status,'granted');
 assert.equal((await prisma.task.findUnique({where:{id:f.task.id}})).sectionId,f.sections.work);
 const results=await Promise.all([move(f.sections.qa),move(f.sections.qa)]);
 assert.equal(results.filter(r=>r.grantId===f.grant.id).length,1);
 assert.equal(results.filter(r=>r.replay===true).length,1);
 const receipt=await prisma.factoryGrant.findUnique({where:{id:f.grant.id}}),task=await prisma.task.findUnique({where:{id:f.task.id}});
 assert.ok(receipt.consumedAt);assert.equal(task.updatedAt.toISOString(),receipt.consumedTaskRevision.toISOString());
 assert.equal((await prisma.factoryTransitionRequest.findUnique({where:{id:f.request.id}})).status,'consumed');
 await move(f.sections.work);
 await assert.rejects(move(f.sections.qa),error=>error.code==='factory_acceptance_required');
 assert.equal((await prisma.task.findUnique({where:{id:f.task.id}})).sectionId,f.sections.work);
});


test('PostgreSQL binds approved future scope and rejects stale template or semantic receipts',async t=>{
 if(unavailable)return t.skip(unavailable);
 const f=await fixture(),ownerSession={userId:f.task.userId,source:'legacy'};
 const inventory=[{id:'policy.code',kind:'implementation',phase:'pre_qa',description:'Approved implementation'},{id:'policy.tests',kind:'tests',phase:'pre_qa',description:'Required tests'},{id:'policy.qa',kind:'independent_qa',phase:'final',description:'Independent revision-bound QA'}];
 await prisma.$transaction(tx=>templates.registerTemplate(tx,{project_id:f.task.projectId,expected_version:0,criteria:inventory},ownerSession));
 assert.equal(await prisma.factoryGrant.count({where:{taskId:f.task.id,consumedAt:null}}),0);
 const scope=[{id:'scope.behavior',kind:'acceptance',phase:'pre_qa',description:'Explicitly approved task behavior'}];
 await prisma.$transaction(tx=>templates.approveRequirements(tx,{project_id:f.task.projectId,task_id:f.task.id,expected_version:0,expected_task_revision:f.task.updatedAt.toISOString(),expected_scope_digest:enforcement.semanticContentDigest(f.task),criteria:scope},ownerSession));
 const {contract}=await prisma.$transaction(tx=>templates.bindTemplate(tx,{project_id:f.task.projectId,task_id:f.task.id},{userId:f.task.userId,agentId:f.dev.id}));
 assert.equal(contract.templateVersion,1);assert.equal(contract.semanticVersion,1);
 await prisma.$transaction(tx=>enforcement.requireCurrentContract(tx,f.task.id,contract.version));
 await prisma.task.update({where:{id:f.task.id},data:{title:'Owner changed the requested scope'}});
 await assert.rejects(prisma.$transaction(tx=>enforcement.requireCurrentContract(tx,f.task.id,contract.version)),error=>error.code==='factory_semantics_unmet');
});
