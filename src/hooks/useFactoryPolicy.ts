"use client";
import {useRef} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';

export type FactoryCriterion={id:string;kind:string;phase:'pre_qa'|'final';description:string};
export type FactoryPolicySnapshot={
  projectId:number;enforcementEnabled:boolean;
  template:null|{version:number;criteria:FactoryCriterion[]};
  semanticReceipt:null|{version:number;criteria:FactoryCriterion[]};
  approval?:{state:'missing'|'current'|'stale';reason:string|null};
  task?:{id:number;projectId:number;updatedAt:string|null;scopeDigest:string;title:string;
    reviewedScope:{title:string|null;description:string|null;acceptanceCriteria:string|null;verifyCommand:string|null}};
};
export const factoryPolicyKey=(projectId:number,taskId?:number)=>['factory-owner-policy',projectId,taskId??null] as const;
export function approvalRequest(projectId:number,taskId:number|undefined,snapshot:FactoryPolicySnapshot,criteria:FactoryCriterion[]){
  if(snapshot.projectId!==projectId||snapshot.task?.id!==taskId||(snapshot.task&&snapshot.task.projectId!==projectId))throw new Error('The selected task changed. Reload its saved scope before approving.');
  return taskId===undefined
    ?{operation:'template',project_id:projectId,expected_version:snapshot.template?.version??0,criteria}
    :{operation:'requirements',project_id:projectId,task_id:taskId,expected_version:snapshot.semanticReceipt?.version??0,
      expected_task_revision:snapshot.task!.updatedAt,expected_scope_digest:snapshot.task!.scopeDigest,criteria};
}
class PolicyError extends Error{constructor(message:string,readonly status:number){super(message);}}
async function request(url:string,init?:RequestInit){
  const response=await fetch(url,{...init,credentials:'same-origin',cache:'no-store',redirect:'error'});
  const value=await response.json();
  if(!response.ok||value.success!==true)throw new PolicyError(response.status===409?'The saved scope or approval changed. Reload and review it again.':response.status===403?'Only the project owner can approve factory requirements.':response.status===400&&typeof value.error==='string'?value.error.slice(0,500):'Factory approval is unavailable. Try again.',response.status);
  return value;
}
export function useFactoryPolicy(projectId:number,taskId?:number){
  const client=useQueryClient();
  const context=useRef({projectId,taskId});context.current={projectId,taskId};
  const query=useQuery<FactoryPolicySnapshot,PolicyError>({queryKey:factoryPolicyKey(projectId,taskId),enabled:projectId>0,retry:false,refetchOnWindowFocus:true,
    queryFn:({signal})=>request(`/api/factory/policy?project_id=${projectId}${taskId===undefined?'':`&task_id=${taskId}`}`,{signal})});
  const mutation=useMutation({mutationFn:async({snapshot,criteria}:{snapshot:FactoryPolicySnapshot;criteria:FactoryCriterion[]})=>{
    const body=approvalRequest(context.current.projectId,context.current.taskId,snapshot,criteria);
    return request('/api/factory/policy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  },onSettled:()=>client.invalidateQueries({queryKey:factoryPolicyKey(projectId,taskId)})});
  return {query,mutation};
}
