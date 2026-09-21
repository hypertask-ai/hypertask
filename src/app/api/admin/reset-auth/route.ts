import { env as appEnv } from "#env";
import { withAuth } from "#with-auth";
import { NextRequest, NextResponse } from 'next/server';

async function POSTHandler(request: NextRequest) {
    let body: { password?: unknown };

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ ok: false }, { status: 401 });
    }

    const adminPassword = appEnv.ADMIN_USER_RESET_PW;

    if (!adminPassword || typeof body.password !== 'string' || body.password !== adminPassword) {
        return NextResponse.json({ ok: false }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
}

export const POST = withAuth(POSTHandler);
