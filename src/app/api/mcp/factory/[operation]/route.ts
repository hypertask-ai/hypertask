import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {isFeatureEnabled,FACTORY_OWNER_PREVIEW_FLAG} from '@/lib/flags';
import { bindTemplate } from '@/lib/factoryAcceptance/templates';
import { validateMcpAuth, checkMcpRateLimit } from '@/lib/mcp/auth';
import { FactoryAcceptanceError } from '@/lib/factoryAcceptance/enforcement';
import { configureEnrollment, registerRevision, registerRequest, registerGrant, listRequests, readStatus } from '@/lib/factoryAcceptance/service';
export const runtime = 'nodejs';
const send = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
async function boundedBody(request: Request) {
    const reader = request.body?.getReader();
    if (!reader)
        throw new FactoryAcceptanceError('factory_invalid_request', 'JSON body required.', 400);
    let bytes = 0, raw = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            bytes += value.byteLength;
            if (bytes > 256 * 1024) {
                await reader.cancel();
                throw new FactoryAcceptanceError('factory_body_too_large', 'Request exceeds 256 KiB.', 413);
            }
            raw += decoder.decode(value, { stream: true });
        }
        raw += decoder.decode();
        const body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new Error();
        return body;
    }
    catch (error) {
        if (error instanceof FactoryAcceptanceError)
            throw error;
        throw new FactoryAcceptanceError('factory_invalid_request', 'A valid JSON object is required.', 400);
    }
}
async function handle(request: NextRequest, context: {
    params: Promise<{
        operation: string;
    }>;
}) {
    try {
        const limited = await checkMcpRateLimit(request);
        if (limited)
            return limited;
        const ctx = await validateMcpAuth(request);
        if (!ctx)
            return send({ success: false, code: 'unauthorized', error: 'Authentication required.' }, 401);
        if (!await isFeatureEnabled(FACTORY_OWNER_PREVIEW_FLAG,ctx.user.id))
            return send({success:false,code:'factory_preview_unavailable',error:'Factory acceptance is unavailable.'},403);
        const identity = { userId: ctx.user.id, agentId: ctx.agentId };
        const { operation } = await context.params;
        if (request.method === 'GET') {
            const projectId = Number(request.nextUrl.searchParams.get('project_id'));
            const result = await prisma.$transaction(async (tx) => {
                if (operation === 'requests')
                    return listRequests(tx, projectId, identity, request.nextUrl.searchParams.get('cursor') || undefined);
                if (operation === 'status')
                    return readStatus(tx, projectId, Number(request.nextUrl.searchParams.get('task_id')), identity, request.nextUrl.searchParams.get('request_id') || undefined);
                throw new FactoryAcceptanceError('factory_unknown_operation', 'Unknown factory operation.', 404);
            });
            return send({ success: true, ...result });
        }
        const operations = { bind:bindTemplate, enrollment: configureEnrollment, revisions: registerRevision, requests: registerRequest, grants: registerGrant };
        if (!Object.hasOwn(operations, operation))
            return send({ success: false, code: 'factory_unknown_operation', error: 'Unknown factory operation.' }, 404);
        const body = await boundedBody(request);
        const operationFn: (tx: Parameters<typeof registerGrant>[0], body: any, identity: Parameters<typeof registerGrant>[2]) => Promise<object> = operations[operation as keyof typeof operations];
        const result = await prisma.$transaction(tx => operationFn(tx, body, identity), { timeout: 15000 });
        return send({ success: true, ...result });
    }
    catch (error) {
        if (error instanceof FactoryAcceptanceError)
            return send({ success: false, code: error.code, error: error.message }, error.status);
        return send({ success: false, code: 'factory_service_unavailable', error: 'Factory acceptance service is unavailable.' }, 503);
    }
}
export const GET = handle;
export const POST = handle;
