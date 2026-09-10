import {NextRequest,NextResponse} from 'next/server';
import prisma from '@/lib/prisma';
import {isFeatureEnabled,FACTORY_OWNER_PREVIEW_FLAG} from '@/lib/flags';
import {getSessionUser} from '@/lib/auth/getSessionUser';
import {FactoryAcceptanceError} from '@/lib/factoryAcceptance/enforcement';
import {approveRequirements,readOwnerPolicy,registerTemplate} from '@/lib/factoryAcceptance/templates';

export const runtime='nodejs';
const send=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:NextRequest){
  try{
    // This approval route never treats a managed agent bearer as an owner.
    if(request.headers.has('authorization'))return send({success:false,code:'factory_owner_session_required'},403);
    if(request.method==='POST'&&request.headers.get('origin')!==request.nextUrl.origin)return send({success:false,code:'factory_invalid_origin'},403);
    const session=await getSessionUser(request.headers);
    if(!session)return send({success:false,code:'factory_owner_session_required'},401);
    if(!await isFeatureEnabled(FACTORY_OWNER_PREVIEW_FLAG,session.userId))return send({success:false,code:'factory_preview_unavailable'},403);
    if(request.method==='GET'){
      const rawTask=request.nextUrl.searchParams.get('task_id');
      const result=await prisma.$transaction(tx=>readOwnerPolicy(tx,Number(request.nextUrl.searchParams.get('project_id')),rawTask===null?undefined:Number(rawTask),session));
      return send({success:true,...result});
    }
    const reader=request.body?.getReader();if(!reader)throw new FactoryAcceptanceError('factory_invalid_request','A JSON body is required.',400);
    let size=0,raw='';const decoder=new TextDecoder('utf-8',{fatal:true});
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256*1024){await reader.cancel();throw new FactoryAcceptanceError('factory_body_too_large','Request exceeds 256 KiB.',413);}raw+=decoder.decode(value,{stream:true});}
    raw+=decoder.decode();let body:any;try{body=JSON.parse(raw);}catch{throw new FactoryAcceptanceError('factory_invalid_request','A valid JSON object is required.',400);}
    const fn=body?.operation==='template'?registerTemplate:body?.operation==='requirements'?approveRequirements:null;
    if(!fn)throw new FactoryAcceptanceError('factory_invalid_request','Choose template or requirements.',400);
    const result=await prisma.$transaction(async (tx):Promise<object>=>await fn(tx,body,session),{timeout:15000});
    return send({success:true,...result});
  }catch(error){
    if(error instanceof FactoryAcceptanceError)return send({success:false,code:error.code,error:error.message},error.status);
    return send({success:false,code:'factory_policy_unavailable'},503);
  }
}
export const GET=handle;
export const POST=handle;
