"use client";
import FactoryApprovalPanel from '@/components/Factory/FactoryApprovalPanel';
export default function FactoryPolicySection({projectId}:{projectId:number}){
  return <FactoryApprovalPanel key={projectId} projectId={projectId}/>;
}
