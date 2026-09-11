"use client";
import {useEffect,useState} from 'react';
import {useFlag} from '@/hooks/useFlag';
import {FACTORY_OWNER_PREVIEW_FLAG} from '@/lib/flags/keys';
import {sanitizeAiHtml} from '@/utils/helperFunctions/sanitizeHtml';
import {FactoryCriterion,FactoryPolicySnapshot,useFactoryPolicy} from '@/hooks/useFactoryPolicy';

const defaults:FactoryCriterion[]=[
  {id:'policy.implementation',kind:'implementation',phase:'pre_qa',description:'Implement every approved product outcome.'},
  {id:'policy.tests',kind:'tests',phase:'pre_qa',description:'Required tests pass for the submitted revision.'},
  {id:'policy.independent_qa',kind:'independent_qa',phase:'final',description:'Independent QA verifies the submitted revision and all approved outcomes.'},
];
function Editor({snapshot,onApprove,busy}:{snapshot:FactoryPolicySnapshot;onApprove:(criteria:FactoryCriterion[])=>void;busy:boolean}){
  const task=!!snapshot.task;
  const saved=(task?snapshot.semanticReceipt:snapshot.template)?.criteria??[];
  const [additions,setAdditions]=useState<FactoryCriterion[]>(task||saved.length?[]:defaults);
  const reviewVersion=JSON.stringify([snapshot.template?.version,snapshot.semanticReceipt?.version,snapshot.task?.scopeDigest,snapshot.task?.updatedAt]);
  const [reviewedVersion,setReviewedVersion]=useState<string|null>(null);
  const reviewed=reviewedVersion===reviewVersion;
  const setReviewed=(value:boolean)=>setReviewedVersion(value?reviewVersion:null);
  useEffect(()=>{
    // Remove only drafts confirmed saved by the server; preserve unrelated local edits.
    const confirmed=(task?snapshot.semanticReceipt:snapshot.template)?.criteria??[];
    setAdditions(rows=>rows.filter(row=>!confirmed.some(item=>item.id===row.id&&item.kind===row.kind&&item.phase===row.phase&&item.description===row.description)));
  },[snapshot.template,snapshot.semanticReceipt,task]);
  const update=(index:number,patch:Partial<FactoryCriterion>)=>{setReviewed(false);setAdditions(rows=>rows.map((row,i)=>i===index?{...row,...patch}:row));};
  return <div className="flex min-w-0 flex-col gap-3">
    {task&&<>
      <p>{snapshot.approval?.state==='current'?'Requirements approved.':snapshot.approval?.reason??'Requirements need approval.'}</p>
      <div className="flex min-w-0 flex-col gap-2 rounded-[5px] border border-border-light-gray-thin p-3">
        <p className="font-semibold">Saved scope to approve</p>
        {Object.entries(snapshot.task!.reviewedScope).map(([field,value])=><div key={field}>
          <p>{({title:'Title',description:'Description',acceptanceCriteria:'Acceptance criteria',verifyCommand:'Verification command'} as Record<string,string>)[field]}</p>
          {field==='description'
            ?<div className="prose min-w-0 max-w-none break-words text-content [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{__html:sanitizeAiHtml(value??'Not set')}}/>
            :<div className={`whitespace-pre-wrap break-words text-content [overflow-wrap:anywhere]${field==='verifyCommand'?' font-mono':''}`}>{value??'Not set'}</div>}
        </div>)}
      </div>
    </>}
    {saved.map(row=><div key={row.id} className="break-words rounded-[5px] border border-border-light-gray-thin p-2 [overflow-wrap:anywhere]">
      <p>{row.description}</p><small>{row.phase==='pre_qa'?'Before QA':'Final verification'} · Approved, cannot be edited</small>
    </div>)}
    {additions.map((row,index)=><div key={row.id} className="flex min-w-0 flex-col gap-2 rounded-[5px] border border-border-light-gray-thin p-2">
      <label>Requirement<textarea className="w-full rounded-[4px] bg-active-modal-element p-2" value={row.description} maxLength={4000} onChange={e=>update(index,{description:e.target.value})}/></label>
      <label>Verify<select className="ml-2 rounded-[4px] bg-active-modal-element p-1" value={row.phase} onChange={e=>update(index,{phase:e.target.value as FactoryCriterion['phase']})}>
        <option value="pre_qa">Before QA</option><option value="final">During final QA</option>
      </select></label>
    </div>)}
    <button type="button" className="self-start underline" onClick={()=>{setReviewed(false);setAdditions(rows=>[...rows,{id:`${task?'scope':'policy'}.${crypto.randomUUID()}`,kind:task?'product_outcome':'verification',phase:task?'final':'pre_qa',description:''}]);}}>Add requirement</button>
    <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/><span>I reviewed these requirements{task?' and the saved scope':''}.</span></label>
    <button type="button" className="self-start rounded-[4px] bg-shadcn-primary text-primary-foreground px-3 py-2 disabled:opacity-50" disabled={busy||!reviewed||saved.length+additions.length===0||additions.some(row=>!row.description.trim())} onClick={()=>onApprove([...saved,...additions])}>
      {busy?'Saving approval…':task?'Approve requirements':'Approve factory policy'}
    </button>
  </div>;
}
export default function FactoryApprovalPanel(props:{projectId:number;taskId?:number}){
  const enabled=useFlag(FACTORY_OWNER_PREVIEW_FLAG);
  return enabled?<FactoryApprovalContents key={`${props.projectId}:${props.taskId}`} {...props}/>:null;
}
function FactoryApprovalContents({projectId,taskId}:{projectId:number;taskId?:number}){
  const {query,mutation}=useFactoryPolicy(projectId,taskId);
  if(query.error?.status===403||query.error?.status===401)return null;
  const snapshot=query.data;
  return <details className="my-3 min-w-0 rounded-[5px] border border-border-light-gray-thin p-3">
    <summary className="cursor-pointer font-semibold">{taskId?'Factory requirements':'Factory policy'}</summary>
    <div className="mt-3 flex min-w-0 flex-col gap-3">
      <p>{snapshot?.enforcementEnabled?'Factory enforcement is enabled.':'Factory enforcement is not enabled by this approval.'} Approval does not mean QA passed.</p>
      {query.isPending&&<p>Loading saved requirements…</p>}
      {query.error&&<p role="alert">{query.error.message}</p>}
      {mutation.error&&<p role="alert">{mutation.error.message}</p>}
      <button type="button" className="self-start underline" disabled={query.isFetching||mutation.isPending} onClick={()=>{mutation.reset();void query.refetch();}}>Reload saved scope</button>
      {snapshot&&<Editor snapshot={snapshot} busy={mutation.isPending||query.isFetching||!!query.error} onApprove={criteria=>mutation.mutate({snapshot,criteria})}/>}
    </div>
  </details>;
}
