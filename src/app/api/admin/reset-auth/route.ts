import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    let body: { password?: unknown };

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ ok: false }, { status: 401 });
    }

    const adminPassword = process.env.ADMIN_USER_RESET_PW;

    if (!adminPassword || typeof body.password !== 'string' || body.password !== adminPassword) {
        return NextResponse.json({ ok: false }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
}
