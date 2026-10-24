const assert = require('node:assert/strict');
const fs = require('node:fs');
const {execFileSync} = require('node:child_process');
const evidence = '/home/valentin/.local/state/vcc-evidence/YPER4-227/smoke-fixture';
const gh = (...args) => execFileSync('gh', args, {encoding:'utf8'});
const git = (...args) => execFileSync('git', args, {encoding:'utf8'}).trim();
const config = () => JSON.parse(fs.readFileSync('.unlazy/proof.json','utf8'));
const pr = () => JSON.parse(gh('pr','view',String(config().pr),'-R','hypertask-ai/hypertask','--json','title,body,baseRefName,headRefName,headRefOid,state,mergedAt,autoMergeRequest'));
const mode=process.argv[2];
if(mode==='root-cause') {
 const run=JSON.parse(gh('run','view','37984280764','-R','hypertask-ai/hypertask','--json','headSha,jobs'));
 assert.equal(run.headSha,'a7373f4706fb04861ec183f89a1ebaccb15d64ae');
 assert.equal(run.jobs.find(j=>j.name==='smoke').conclusion,'failure');
 const log=fs.readFileSync(`${evidence}/production-smoke.log`,'utf8');
 assert.match(log,/Production smoke authenticated as QA user 985/);
 assert.match(log,/\/project\?id=6859&surface=board missing/);
 assert.match(log,/\/detail\/project-6859\/43 missing/);
 const owner=JSON.parse(fs.readFileSync(`${evidence}/old-fixture-owner.json`,'utf8'));
 assert.equal(owner.ownerId,2343);assert.deepEqual(owner.members,[]);
 const reads=fs.readFileSync(`${evidence}/qa-fixtures.txt`,'utf8');
 assert.match(reads,/"projectId":6859,"membersStatus":404,"boardStatus":403/);
} else if(mode==='fixture') {
 const {request}=require('@playwright/test');
 (async()=>{const ctx=await request.newContext({baseURL:'https://app.hypertask.ai',storageState:`${evidence}/qa-state.json`});try{
 const identity=await ctx.get('/api/users/getById');assert.equal(identity.status(),200);assert.equal((await identity.json()).id,985);
 const members=await ctx.get('/api/members/getAllForAssignees?projectId=6121');assert.equal(members.status(),200);
 const m=await members.json();assert.equal(m.owner.id,985);assert.deepEqual(m.members,[]);
 const res=await ctx.post('/api/projects/boardTasks',{data:{projectId:6121}});assert.equal(res.status(),200);
 const board=await res.json();const t=board.tasks.find(t=>t.uniqueIndex===1);assert.equal(t.status,'Normal');assert.equal(t.title,'Midscene persistent browser target');assert(board.project.section.some(s=>s.id===t.sectionId&&s.visibility));
 const workflow=fs.readFileSync('.github/workflows/prod-health.yml','utf8');assert.match(workflow,/SMOKE_BOARD_PATH: '\/project\?id=6121&surface=board'/);assert.match(workflow,/SMOKE_TASK_PATH: '\/detail\/project-6121\/1'/);
 assert.deepEqual(git('diff','--name-only','origin/production...HEAD').split('\n').filter(Boolean).sort(),['.github/workflows/prod-health.yml','e2e/smoke/README.md','tests/postdeploy-browser-smoke.test.cjs']);
 console.log('fixture verified');
 }finally{await ctx.dispose();}})().catch(e=>{console.error(e);process.exitCode=1;});
 return;
} else if(mode==='branch') {
 assert.equal(git('branch','--show-current'),'yper4-227-smoke-fixture');
 assert.equal(git('rev-parse','HEAD^'),'a7373f4706fb04861ec183f89a1ebaccb15d64ae');
 assert.equal(git('log','-1','--format=%s'),'YPER4-227 [INFRA] Browser smoke uses a QA fixture that exists');
 assert.equal(git('diff','--name-only'),'');
} else if(mode==='pr') {
 const p=pr();assert.equal(p.title,'YPER4-227 [INFRA] Browser smoke uses a QA fixture that exists');
 assert.equal(p.baseRefName,'production');assert.equal(p.headRefName,'yper4-227-smoke-fixture');assert.equal(p.headRefOid,git('rev-parse','HEAD'));
 assert.equal(p.state,'OPEN');assert.equal(p.mergedAt,null);assert.equal(p.autoMergeRequest,null);
 assert(p.body.startsWith('Summary for non-engineers\n'));assert(!p.body.includes('\u2014'));
 for(const section of ['What went wrong','What changes','What you will see','Watch out for'])assert(p.body.includes(section));
 assert.match(p.body,/What changes\n1\./);assert(p.body.trimEnd().endsWith('🤖 Generated with [Claude Code](https://claude.com/claude-code)'));
} else if(mode==='checks') {
 const sha=git('rev-parse','HEAD');
 const statuses=JSON.parse(gh('api',`repos/hypertask-ai/hypertask/commits/${sha}/status`)).statuses;
 const checks=JSON.parse(gh('api',`repos/hypertask-ai/hypertask/commits/${sha}/check-runs?per_page=100`)).check_runs;
 const latest=new Map();
 for(const c of checks.sort((a,b)=>b.id-a.id))if(!latest.has(c.name))latest.set(c.name,c.conclusion);
 for(const s of statuses)latest.set(s.context,s.state);
 const required=require('js-yaml').load(fs.readFileSync('docs/ci-policy.yml','utf8')).required_checks.contexts;
 for(const name of required)assert.equal(latest.get(name),'success',`required ${name} missing or not passing`);
 assert.equal(pr().headRefOid,sha);
} else if(mode==='smoke') {
 const run=JSON.parse(gh('run','view',String(config().smokeRun),'-R','hypertask-ai/hypertask','--json','headSha,event,jobs'));
 assert.equal(run.headSha,git('rev-parse','HEAD'));assert.equal(run.event,'workflow_dispatch');
 assert.equal(run.jobs.find(j=>j.name==='smoke').conclusion,'success');
 for(const name of ['core-actions','provision-core-actions','rollback','glm-qa'])assert.equal(run.jobs.find(j=>j.name===name).conclusion,'skipped');
 const log=fs.readFileSync(`${evidence}/branch-smoke.log`,'utf8');assert.match(log,/Production smoke authenticated as QA user 985/);
 for(const viewport of ['Desktop','Mobile'])assert(log.includes(`${viewport}: QA board card opened /detail/project-6121/1 and stayed open for 10 seconds without reload`));
 assert.match(log,/16 passed/);
} else if(mode==='final') {
 const p=pr();assert.equal(p.state,'OPEN');assert.equal(p.mergedAt,null);assert.equal(p.autoMergeRequest,null);assert.equal(p.headRefOid,git('rev-parse','HEAD'));assert.equal(git('diff','--name-only'),'');
 assert(fs.existsSync(`${evidence}/handoff.md`));
} else throw Error('unknown gate');
console.log(`${mode} verified`);
