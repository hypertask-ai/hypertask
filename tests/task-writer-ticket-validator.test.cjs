const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./task-route-loader.cjs');
const template=load('src/lib/tickets/plainLanguageTicket.mjs');
const writing=load('src/lib/agents/writing.ts');
const output='<h1 id="ai-generated-task-title">Search finds reminders</h1>'+template.renderPlainLanguageTicketDescription({whatWrongOrWanted:'Search misses reminders.',whoItAffects:'Everyone.',recommendedCourseAndWhy:'Restore search. People need reminders.',whatValentinMustDecide:'Nothing.',howToUndo:'Revert the change.'})+'<pre>node scripts/repro.mjs --project_id 15</pre>';
function writer(text) {
 return load('src/app/api/ai/_lib/taskWriterDraft.ts',{
  'ai':{generateText:async()=>({text})},
  './taskWriterRun':{prepareTaskWriterRun:async()=>({selected:{model:{},modelId:'fixture',settings:{}},instructions:template.plainLanguageTicketWriterRule(),messages:[],skills:[],validateDraft:true})},
  './modelProvider':{configureAiModelUsage(){}},
  './editorAi':{filterOneImagePass:text=>({emit:text})},
  '@/lib/net/downloadWithoutBrotli':{downloadWithoutBrotli(){}},
  '@/lib/agents/writing':writing,
 }).generateTaskWriterDraft({aiMode:'AiTaskWriter',taskTitle:'',PROMPT:'Restore search'},6,'agent');
}
test('the actual writer draft output passes the ticket validator',async()=>{
 const draft=await writer(output);
 assert.equal(draft.success,true);
 assert.doesNotThrow(()=>writing.assertAgentWriting('agent',{title:draft.title,description:draft.html},{},{create:true,houseRules:true}));
});
test('the writer refuses its own invalid output before returning success',async()=>{
 const draft=await writer(output.replace('Everyone.','Next: inspect src/lib/search.ts.'));
 assert.equal(draft.success,false);
 assert.match(draft.error,/Robot status/);
 assert.match(draft.error,/Technical detail/);
});
