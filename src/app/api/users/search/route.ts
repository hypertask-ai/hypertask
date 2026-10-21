import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: NextRequest) {
    try {
        const adminPassword = process.env.ADMIN_USER_RESET_PW;
        if (
            !adminPassword ||
            request.headers.get('x-admin-password') !== adminPassword
        ) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const query = searchParams.get('q') || '';
        const limit = parseInt(searchParams.get('limit') || '50', 10);

        if (!query || query.trim().length < 2) {
            return NextResponse.json(
                { error: 'Search query must be at least 2 characters long' },
                { status: 400 }
            );
        }

        const searchTerm = query.trim().toLowerCase();

        const users = await prisma.user.findMany({
            where: {
                OR: [
                    {
                        email: {
                            contains: searchTerm,
                        },
                    },
                    {
                        displayName: {
                            contains: searchTerm,
                        },
                    },
                ],
            },
            take: limit,
            orderBy: {
                joinedAt: 'desc',
            },
            select: {
                id: true,
                email: true,
                displayName: true,
                photoURL: true,
                UserSetting: {
                    select: {
                        trialStatus: true,
                    },
                },
                joinedAt: true,
            },
        });

        const filteredUsers = users.filter(
            (user) =>
                user.email?.toLowerCase().includes(searchTerm) ||
                user.displayName?.toLowerCase().includes(searchTerm)
        );

        return NextResponse.json({
            success: true,
            users: filteredUsers,
            count: filteredUsers.length,
        });
    } catch (error: any) {
        console.error('❌ Error searching users:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to search users',
            },
            { status: 500 }
        );
    }
}
