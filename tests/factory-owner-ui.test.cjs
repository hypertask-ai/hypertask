const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const React=require('react');
function load(relative,overrides={}){
 const filename=path.resolve(__dirname,'..',relative),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
 mod.require=id=>Object.hasOwn(overrides,id)?overrides[id]:require(id);
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);return mod.exports;
}
const api=load('src/hooks/useFactoryPolicy.ts');
const snapshot=(taskId=1)=>({projectId:15,enforcementEnabled:false,template:null,semanticReceipt:null,approval:{state:'missing',reason:'Requirements have not been approved.'},task:{id:taskId,projectId:15,updatedAt:'2026-09-10T00:00:00.000Z',scopeDigest:'a'.repeat(64),title:'Full task title',reviewedScope:{title:'Full task title',description:'<p><strong>Saved outcome</strong></p><img src=x onerror=alert(1)><script>unsafeScript()</script><a href=javascript:alert(1)>Inspect outcome</a>',acceptanceCriteria:'Required outcome',verifyCommand:'npm test'}}});
test('approval request rejects cross-task and cross-project snapshots before sending',()=>{
 const old=snapshot();
 assert.throws(()=>api.approvalRequest(15,2,old,[]),/selected task changed/);
 assert.throws(()=>api.approvalRequest(16,1,old,[]),/selected task changed/);
 assert.throws(()=>api.approvalRequest(15,undefined,old,[]),/selected task changed/);
 const body=api.approvalRequest(15,1,old,[]);
 assert.equal(body.expected_scope_digest,old.task.scopeDigest);assert.equal(body.expected_task_revision,old.task.updatedAt);
 assert.equal(body.task_id,1);assert.equal(body.project_id,15);
});
test('approval panel requires explicit review, resets on navigation and renders scope without executing HTML',async()=>{
 const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>',{url:'https://example.invalid'});
 const previous={window:global.window,document:global.document,act:global.IS_REACT_ACT_ENVIRONMENT};
 global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const {createRoot}=require('react-dom/client'),{act}=React;
 let data=snapshot(),sent=[];
 let flagEnabled=true,policyReads=0;
 const hook={useFactoryPolicy:()=>{policyReads++;return ({query:{data,error:null,isPending:false,isFetching:false,refetch:async()=>{}},mutation:{error:null,isPending:false,reset:()=>{},mutate:value=>sent.push(value)}});}};
 const Panel=load('src/components/Factory/FactoryApprovalPanel.tsx',{'@/hooks/useFactoryPolicy':hook,'@/hooks/useFlag':{useFlag:()=>flagEnabled},'@/lib/flags/keys':{FACTORY_OWNER_PREVIEW_FLAG:'hyfa-43-factory-owner-preview'},'@/utils/helperFunctions/sanitizeHtml':load('src/utils/helperFunctions/sanitizeHtml.ts')}).default;
 const root=createRoot(document.getElementById('root'));
 try{
  flagEnabled=false;
  await act(async()=>root.render(React.createElement(Panel,{projectId:15,taskId:1})));
  assert.equal(policyReads,0);assert.equal(document.body.textContent,'');
  flagEnabled=true;
  await act(async()=>root.render(React.createElement(Panel,{projectId:15,taskId:1})));
  assert.ok(policyReads>0);assert.equal(sent.length,0);
  assert.equal(document.querySelector('img').hasAttribute('onerror'),false);
  assert.doesNotMatch(document.body.textContent,/<img|onerror=/);
  assert.match(document.body.textContent,/Saved outcome/);
  assert.equal(document.querySelector('strong').textContent,'Saved outcome');
  assert.equal(document.querySelectorAll('script').length,0);
  assert.equal(document.querySelector('a').getAttribute('href'),null);
  assert.doesNotMatch(document.body.textContent,/unsafeScript/);
  const add=()=>[...document.querySelectorAll('button')].find(x=>x.textContent==='Add requirement');
  await act(async()=>add().click());
  const textarea=document.querySelector('textarea');
  await act(async()=>{
   const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set;
   setter.call(textarea,'The requested product outcome works');textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
  // A new task must never inherit the previous task's approval checkbox.
  await act(async()=>document.querySelector('input[type=checkbox]').click());
  data=snapshot(2);
  await act(async()=>root.render(React.createElement(Panel,{projectId:15,taskId:2})));
  assert.equal(document.querySelector('input[type=checkbox]').checked,false);
  assert.equal(document.querySelectorAll('textarea').length,0);
  assert.equal(sent.length,0);
  data={...snapshot(2),semanticReceipt:{version:1,criteria:[{id:'scope.one',kind:'product_outcome',phase:'final',description:'Approved outcome'}]}};
  await act(async()=>root.render(React.createElement(Panel,{projectId:15,taskId:2})));
  assert.equal(document.querySelectorAll('textarea').length,0);
  const approve=()=>[...document.querySelectorAll('button')].find(x=>x.textContent==='Approve requirements');
  assert.equal(approve().disabled,true);
  await act(async()=>document.querySelector('input[type=checkbox]').click());
  await act(async()=>approve().click());
  assert.equal(sent.length,1);assert.equal(sent[0].snapshot.task.id,2);assert.equal(sent[0].criteria[0].description,'Approved outcome');
  assert.equal(sent[0].snapshot.task.scopeDigest,data.task.scopeDigest);
  assert.equal(sent[0].snapshot.task.reviewedScope.description,data.task.reviewedScope.description);
 }finally{await act(async()=>root.unmount());dom.window.close();global.window=previous.window;global.document=previous.document;global.IS_REACT_ACT_ENVIRONMENT=previous.act;}
});
