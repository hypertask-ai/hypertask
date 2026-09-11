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
 const previous={window:global.window,document:global.document,navigator:Object.getOwnPropertyDescriptor(global,'navigator'),act:global.IS_REACT_ACT_ENVIRONMENT};
 global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 Object.defineProperty(global,'navigator',{configurable:true,value:dom.window.navigator});
 const {createRoot}=require('react-dom/client'),{act}=React;
 let data=snapshot(),sent=[];
 let flagEnabled=true,policyReads=0,queryError=null;
 const hook={useFactoryPolicy:()=>{policyReads++;return ({query:{data,error:queryError,isPending:false,isFetching:false,refetch:async()=>{}},mutation:{error:null,isPending:false,reset:()=>{},mutate:value=>sent.push(value)}});}};
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
  const phase=document.querySelector('select');
  await act(async()=>{phase.value='pre_qa';phase.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await act(async()=>document.querySelector('input[type=checkbox]').click());
  data={...data,task:{...data.task,scopeDigest:'b'.repeat(64),reviewedScope:{...data.task.reviewedScope,title:'Changed saved title'}}};
  await act(async()=>root.render(React.createElement(Panel,{projectId:15,taskId:1})));
  assert.equal(document.querySelectorAll('textarea').length,1,'Refreshing scope must retain the draft');
  assert.equal(document.querySelector('select').value,'pre_qa','Draft edits must survive refresh');
  assert.equal(document.querySelector('input[type=checkbox]').checked,false,'Changed scope needs another review');
  queryError={status:503,message:'Temporary read failure'};
  await act(async()=>root.render(React.createElement(Panel,{projectId:15,taskId:1})));
  assert.equal(document.querySelectorAll('textarea').length,1,'Transient failures must retain the draft');
  await act(async()=>document.querySelector('input[type=checkbox]').click());
  assert.equal([...document.querySelectorAll('button')].find(x=>x.textContent.includes('Saving approval')).disabled,true);
  queryError=null;
  await act(async()=>root.render(React.createElement(Panel,{projectId:15,taskId:1})));
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
  data={...data,task:{...data.task,updatedAt:'2026-09-10T00:01:00.000Z'}};
  await act(async()=>root.render(React.createElement(Panel,{projectId:15,taskId:2})));
  assert.equal(document.querySelector('input[type=checkbox]').checked,false,'A new task revision also needs review');
  data={projectId:15,enforcementEnabled:false,template:null,semanticReceipt:null};
  await act(async()=>root.render(React.createElement(Panel,{projectId:15})));
  const approvedDefaults=[...document.querySelectorAll('textarea')].map((input,index)=>({
   id:['policy.implementation','policy.tests','policy.independent_qa'][index],
   kind:['implementation','tests','independent_qa'][index],
   phase:index===2?'final':'pre_qa',description:input.value,
  }));
  assert.equal(approvedDefaults.length,3);
  await act(async()=>add().click());
  data={...data,template:{version:1,criteria:approvedDefaults}};
  await act(async()=>root.render(React.createElement(Panel,{projectId:15})));
  assert.equal(document.querySelectorAll('textarea').length,1,'Confirmed drafts disappear while unrelated additions remain');
  assert.equal(document.querySelector('textarea').value,'');

 }finally{await act(async()=>root.unmount());dom.window.close();global.window=previous.window;global.document=previous.document;global.IS_REACT_ACT_ENVIRONMENT=previous.act;if(previous.navigator)Object.defineProperty(global,'navigator',previous.navigator);else delete global.navigator;}
});

function entryComponent(relative,name,bindings){
 const source=fs.readFileSync(path.resolve(__dirname,'..',relative),'utf8');
 const tree=ts.createSourceFile(relative,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let initializer;
 for(const statement of tree.statements){
  if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){
   if(declaration.name.getText(tree)===name)initializer=declaration.initializer.getText(tree);
  }
 }
 assert.ok(initializer,`Missing actual entry ${name}`);
 const compiled=ts.transpileModule(`const Entry=${initializer};module.exports=Entry;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const mod={exports:{}};
 new Function('require','module','exports',...Object.keys(bindings),compiled)(require,mod,mod.exports,...Object.values(bindings));
 return mod.exports;
}
test('actual settings and desktop/mobile task entries do not mount factory queries when preview is off',()=>{
 const {renderToStaticMarkup}=require('react-dom/server');
 let enabled=false,mounts=0,flagReads=0,mobile=false;
 const gatedBindings={FACTORY_OWNER_PREVIEW_FLAG:'hyfa-43-factory-owner-preview',useFlag:key=>{assert.equal(key,'hyfa-43-factory-owner-preview');flagReads++;return enabled;}};
 const empty=()=>null;
 const factory=()=>{mounts++;return React.createElement('span',null,'Factory panel');};
 const shell=({children})=>React.createElement('section',null,children);
 const Settings=entryComponent('src/components/Modals/Settings/BoardGeneralSection.tsx','BoardGeneralSection',{
  ...gatedBindings,useSettingsTeam:()=>({project:{id:15}}),SettingsSectionShell:shell,
  BoardNotificationSetting:()=>React.createElement('span',null,'Ordinary settings'),BoardTimeTrackingSetting:empty,
  BoardLifecycleSettings:empty,BoardAutoAssignSetting:empty,FactoryPolicySection:factory,
 });
 const Task=entryComponent('src/components/PageComponents/TaskDetail/CommentAndDescription/index.tsx','CommentAndDescriptionContainer',{
  ...gatedBindings,useContext:()=>mobile,MobileViewContext:{},
  useDescriptionAndCommentsContext:()=>({comments:[],stacked:[]}),
  useTaskContext:()=>({currentTask:{id:1,projectId:15},allowPerks:true,
   virtualizer:{getTotalSize:()=>100,getVirtualItems:()=>[{index:0,key:'bottom',start:0}],measureElement:()=>{}},
   virtualizeIndexes:{descriptionBottomVirtualIndex:0},
  }),taskDetailSpacing:{mobile:{descriptionContainer:''}},BaseCommentAndDescriptionContainer:shell,
  RichTextPersonHovercards:empty,FactoryRequirementsPanel:factory,NewCommentComponent:()=>React.createElement('span',null,'Ordinary composer'),
 });
 for(const value of [false,true]){
  enabled=value;mounts=0;flagReads=0;
  const settings=renderToStaticMarkup(React.createElement(Settings));
  assert.match(settings,/Ordinary settings/);
  for(mobile of [false,true]){
   const html=renderToStaticMarkup(React.createElement(Task,{}));
   if(!mobile)assert.match(html,/Ordinary composer/);
  }
  assert.equal(flagReads,3);assert.equal(mounts,value?3:0);
 }
});
test('the actual save hook invalidation is disabled with the preview flag',()=>{
 const filename='src/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent.ts';
 const source=fs.readFileSync(path.resolve(__dirname,'..',filename),'utf8');
 const tree=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true);
 let statement;
 function visit(node){
  if(ts.isIfStatement(node)&&node.expression.getText(tree).startsWith('factoryPreviewEnabled &&'))statement=node.getText(tree);
  ts.forEachChild(node,visit);
 }
 visit(tree);assert.ok(statement,'Expected a conditional factory approval-query refresh');
 const compiled=ts.transpileModule(statement,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const run=new Function('factoryPreviewEnabled','currentTask','queryClient','factoryPolicyKey',compiled);
 const calls=[];
 const client={invalidateQueries:value=>calls.push(value)};
 run(false,{projectId:15,id:1},client,api.factoryPolicyKey);assert.equal(calls.length,0);
 run(true,{projectId:15,id:1},client,api.factoryPolicyKey);assert.deepEqual(calls,[{queryKey:api.factoryPolicyKey(15,1)}]);
});
