"use client";
import FactoryApprovalPanel from '@/components/Factory/FactoryApprovalPanel';
export default function FactoryRequirementsPanel({projectId,taskId}:{projectId:number;taskId:number}){
  return <FactoryApprovalPanel key={`${projectId}:${taskId}`} projectId={projectId} taskId={taskId}/>;
}
